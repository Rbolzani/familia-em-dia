import { createAdminClient } from '@/lib/supabase/server'
import { stripe, planoDoPreco } from '@/lib/stripe'
import type Stripe from 'stripe'
import { DIAS_ATE_APAGAR } from '@/lib/oferta-v2'
import { avisarCartaoRecusado, avisarPausa } from '@/lib/avisos-conta'

const GRACE_DAYS = 5

/**
 * Zera a cota MENSAL de IA quando o plano cai de pago para grátis.
 *
 * POR QUE
 * O contador `ai_uses_this_month` não distingue em que plano cada uso
 * aconteceu. Quem usou 18 capturas pagando (limite Infinity) e depois voltou
 * ao gratuito era recebido com **"18 / 5 — limite atingido"**: as capturas
 * que ele PAGOU eram cobradas retroativamente contra a franquia grátis.
 * Fora o número incoerente, a punição chega no pior momento — logo após
 * cancelar, ou depois de um pagamento que falhou.
 *
 * ⚠️ SÓ NA TRANSIÇÃO. Zerar sempre que o estado for grátis daria IA
 * ilimitada ao plano gratuito: `syncSubscriptionToDb` roda a cada webhook e a
 * cada abertura de /planos, e cada passagem zeraria a conta de novo. Por isso
 * lemos o plano atual antes e só agimos quando ele era pago.
 *
 * O teto DIÁRIO (`ai_calls_today`) não é tocado — ele existe contra abuso, e
 * abuso não muda de natureza quando alguém cancela.
 */
async function zerarCotaSeCaiuParaGratis(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  planoNovo: string,
): Promise<{ ai_uses_this_month: number; ai_uses_reset_at: string } | undefined> {
  if (planoNovo !== 'free') return undefined
  const { data } = await admin
    .from('subscriptions')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle()
  const planoAtual = data?.plan as string | undefined
  if (planoAtual !== 'familia' && planoAtual !== 'plus') return undefined
  console.warn('[stripe-sync] %s → free: cota mensal de IA zerada', planoAtual)
  return { ai_uses_this_month: 0, ai_uses_reset_at: new Date().toISOString() }
}

// Quando o owner perde o plano pago e ainda tem parceiro(s) conectado(s),
// inicia um período de graça de 5 dias antes de o parceiro ser desconectado
// (a remoção em si é feita pelo cron expire-trials, fase 2).
// Retorna o timestamp do fim da graça, ou undefined se não se aplica.
async function computePartnerGraceUntil(
  admin: ReturnType<typeof createAdminClient>,
  ownerUserId: string,
): Promise<string | undefined> {
  const { data: fam } = await admin
    .from('families')
    .select('id')
    .eq('created_by', ownerUserId)
    .maybeSingle()
  if (!fam?.id) return undefined

  const { count } = await admin
    .from('family_members')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', fam.id)
    .eq('role', 'partner')
  if ((count ?? 0) === 0) return undefined

  // Não reinicia se já houver uma graça em andamento.
  const { data: existing } = await admin
    .from('subscriptions')
    .select('partner_grace_until')
    .eq('user_id', ownerUserId)
    .maybeSingle()
  if (existing?.partner_grace_until) return undefined

  return new Date(Date.now() + GRACE_DAYS * 86_400_000).toISOString()
}

// Converte timestamp unix (segundos) → ISO, ou null.
function toISO(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null
}

// Em versões recentes da API, current_period_end migrou do objeto Subscription
// para o item da assinatura. Lê dos dois lugares por compatibilidade.
function getPeriodEnd(sub: Stripe.Subscription): number | null {
  const loose = sub as unknown as { current_period_end?: number }
  if (typeof loose.current_period_end === 'number') return loose.current_period_end
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined
  return item?.current_period_end ?? null
}

// Resolve o user_id interno a partir da assinatura do Stripe.
async function resolveUserId(
  admin: ReturnType<typeof createAdminClient>,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id
  if (fromMeta) return fromMeta

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customerId) return null
  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return (data?.user_id as string) ?? null
}

// Grava o estado de uma assinatura do Stripe no banco (upsert por user_id).
export async function syncSubscriptionToDb(
  sub: Stripe.Subscription,
  userIdOverride?: string,
): Promise<void> {
  const admin = createAdminClient()
  const userId = userIdOverride ?? await resolveUserId(admin, sub)
  if (!userId) {
    console.error('[stripe-sync] user_id não resolvido para sub', sub.id)
    return
  }

  const price = sub.items?.data?.[0]?.price
  const mapped = price ? planoDoPreco(price) : null
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id

  const isEnded = sub.status === 'canceled' || sub.status === 'incomplete_expired'

  const { data: atual } = await admin
    .from('subscriptions')
    .select('status, oferta, plan, stripe_subscription_id, paused_at, pause_reason, payment_failed_at')
    .eq('user_id', userId)
    .maybeSingle()

  // Evento atrasado de uma assinatura antiga (ex.: a pessoa reativou e há
  // outra assinatura viva): não pode sobrescrever o estado da atual.
  if (isEnded && atual?.stripe_subscription_id && atual.stripe_subscription_id !== sub.id) return

  if (atual?.oferta === 'v2') {
    await syncV2(admin, userId, sub, atual, mapped, customerId ?? null, isEnded)
    return
  }

  // Pago/trial → grátis com parceiro conectado: inicia grace de 5 dias.
  // Voltou a ficar ativo: limpa qualquer grace pendente.
  let graceField: { partner_grace_until: string | null } | undefined
  if (isEnded) {
    const grace = await computePartnerGraceUntil(admin, userId)
    if (grace) graceField = { partner_grace_until: grace }
  } else {
    graceField = { partner_grace_until: null }
  }

  const planoNovo = isEnded ? 'free' : (mapped?.plan ?? 'free')
  const cotaZerada = await zerarCotaSeCaiuParaGratis(admin, userId, planoNovo)

  await admin.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    plan: planoNovo,
    status: isEnded ? 'free' : sub.status,
    billing_interval: isEnded ? null : (mapped?.interval ?? null),
    trial_ends_at: toISO(sub.trial_end),
    current_period_end: toISO(getPeriodEnd(sub)),
    // `cancel_at` cobre o caso do schedule: quando a assinatura e governada
    // por um `subscription_schedule`, o Stripe agenda o fim em `cancel_at` e
    // deixa `cancel_at_period_end` em FALSE. Ler so o segundo faria a tela
    // dizer "Ativo · renova em 2027" para quem acabou de cancelar.
    cancel_at_period_end: (sub.cancel_at_period_end ?? false) || !!sub.cancel_at,
    ...graceField,
    ...cotaZerada,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

// ── Modelo novo (teste com cartão, sem gratuito) ────────────────────────────
// Estados: trialing · active · past_due (cartão recusado, 7 dias de carência)
// · paused (sem assinatura válida; só leitura; apagada em 90 dias)
// · incompleto (sem cartão ainda — inclui o teste cancelado por cartão repetido).
type LinhaAtual = { status: string | null; plan: string | null; paused_at: string | null; pause_reason: string | null; payment_failed_at: string | null }

async function syncV2(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sub: Stripe.Subscription,
  atual: LinhaAtual,
  mapped: ReturnType<typeof planoDoPreco>,
  customerId: string | null,
  isEnded: boolean,
): Promise<void> {
  const agora = new Date()
  const base = {
    user_id: userId,
    stripe_customer_id: customerId,
    plan: mapped?.plan ?? atual.plan ?? 'familia',
    billing_interval: mapped?.interval ?? null,
    trial_ends_at: toISO(sub.trial_end),
    current_period_end: toISO(getPeriodEnd(sub)),
    partner_grace_until: null,
    updated_at: agora.toISOString(),
  }

  if (isEnded || sub.status === 'unpaid') {
    // Teste cancelado porque o cartão já tinha usado o teste: volta a
    // "incompleto" (a pessoa escolhe assinar sem teste — T5).
    if (sub.metadata?.motivo_fim === 'cartao_ja_usado') {
      await admin.from('subscriptions').update({ status: 'incompleto', stripe_subscription_id: null, trial_ends_at: null, updated_at: agora.toISOString() }).eq('user_id', userId)
      return
    }
    // Assinatura acabou (cancelada e o período terminou, ou o Stripe desistiu
    // de cobrar): conta pausada. Mantém a data da pausa se já estava pausada.
    const pausadaEm = atual.status === 'paused' && atual.paused_at ? new Date(atual.paused_at) : agora
    const motivo = atual.status === 'past_due' || atual.payment_failed_at || atual.pause_reason === 'pagamento' || sub.status === 'unpaid'
      ? 'pagamento' : 'cancelada'
    await admin.from('subscriptions').upsert({
      ...base,
      stripe_subscription_id: sub.id,
      status: 'paused',
      cancel_at_period_end: false,
      paused_at: pausadaEm.toISOString(),
      pause_reason: motivo,
      delete_after: new Date(pausadaEm.getTime() + DIAS_ATE_APAGAR * 86_400_000).toISOString(),
      payment_failed_at: null,
    }, { onConflict: 'user_id' })
    if (atual.status !== 'paused') await avisarPausa(userId).catch(e => console.error('[stripe-sync] aviso de pausa:', e))
    return
  }

  // Pausada por falta de pagamento (7 dias sem regularizar) enquanto o Stripe
  // ainda tenta cobrar: continua pausada até o pagamento entrar.
  if (atual.status === 'paused' && atual.pause_reason === 'pagamento' && sub.status === 'past_due') {
    await admin.from('subscriptions').update({ stripe_subscription_id: sub.id, updated_at: agora.toISOString() }).eq('user_id', userId)
    return
  }

  const status = sub.status === 'incomplete' ? 'incompleto' : sub.status
  const entrouEmAtraso = status === 'past_due' && atual.status !== 'past_due'
  await admin.from('subscriptions').upsert({
    ...base,
    stripe_subscription_id: sub.id,
    status,
    // `cancel_at` cobre o caso do schedule (ver o modelo antigo acima).
    cancel_at_period_end: (sub.cancel_at_period_end ?? false) || !!sub.cancel_at,
    payment_failed_at: status === 'past_due' ? (atual.payment_failed_at ?? agora.toISOString()) : null,
    paused_at: null,
    pause_reason: null,
    delete_after: null,
  }, { onConflict: 'user_id' })
  if (entrouEmAtraso) await avisarCartaoRecusado(userId, 'd0').catch(e => console.error('[stripe-sync] aviso de cartão recusado:', e))
}

// Escolhe a assinatura "vigente" entre as do cliente:
// 1) ativa/trial e NÃO cancelando  → é a assinatura efetiva
// 2) ativa/trial cancelando         → ainda dá acesso até o fim do período
// 3) a mais recente                 → fallback (canceladas, etc.)
function pickCurrentSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subs.length === 0) return null
  const live = subs.filter(s => s.status === 'active' || s.status === 'trialing')
  // Mesmo cuidado do upsert: com schedule, o fim agendado vem em `cancel_at`
  // e não em `cancel_at_period_end`. Ignorar isso faria uma assinatura já
  // cancelada ser escolhida como "a não cancelante", e o app a trataria como
  // renovação normal.
  const cancelando = (s: Stripe.Subscription) => !!s.cancel_at_period_end || !!s.cancel_at
  const notCancelling = live.find(s => !cancelando(s))
  if (notCancelling) return notCancelling
  if (live.length > 0) return live.sort((a, b) => b.created - a.created)[0]
  return subs.sort((a, b) => b.created - a.created)[0]
}

// Reconcilia o banco com a verdade do Stripe para um usuário.
// Chamado ao carregar telas de billing — torna o app robusto mesmo
// quando um webhook se perde ou atrasa. Retorna true se sincronizou.
export async function reconcileUserFromStripe(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, trial_ends_at, oferta, status, plan, paused_at, pause_reason, payment_failed_at')
    .eq('user_id', userId)
    .maybeSingle()

  const customerId = row?.stripe_customer_id as string | null | undefined
  if (!customerId) return false

  try {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    })
    const current = pickCurrentSubscription(list.data)

    if (row?.oferta === 'v2') {
      if (current) { await syncSubscriptionToDb(current, userId); return true }
      // Sem nenhuma assinatura: quem ainda não pôs o cartão continua
      // "incompleto"; quem já teve assinatura fica pausado.
      if (row.status === 'incompleto' || row.status === 'paused') return false
      const agora = new Date()
      await admin.from('subscriptions').update({
        status: 'paused', paused_at: agora.toISOString(), pause_reason: row.payment_failed_at ? 'pagamento' : 'cancelada',
        delete_after: new Date(agora.getTime() + DIAS_ATE_APAGAR * 86_400_000).toISOString(),
        stripe_subscription_id: null, cancel_at_period_end: false, payment_failed_at: null, updated_at: agora.toISOString(),
      }).eq('user_id', userId)
      await avisarPausa(userId).catch(e => console.error('[stripe-sync] aviso de pausa:', e))
      return true
    }

    // Sem assinatura, mas o teste grátis do CADASTRO ainda vale: a pessoa abriu
    // o pagamento e desistiu (o cliente no Stripe nasce antes do cartão). Ela
    // continua no teste até o fim — antes caía no gratuito na hora (caso real
    // de 16/10/2026). O teste é do app, não do Stripe: vem de trial_ends_at.
    const fimTeste = row?.trial_ends_at ? new Date(row.trial_ends_at as string).getTime() : 0
    if (!current && fimTeste > Date.now()) {
      await admin.from('subscriptions').update({
        plan: 'familia',
        status: 'trialing',
        billing_interval: null,
        cancel_at_period_end: false,
        current_period_end: null,
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)
      return true
    }

    if (!current) {
      // Sem nenhuma assinatura no Stripe → garante estado free.
      // Se houver parceiro conectado, inicia o grace de 5 dias.
      const grace = await computePartnerGraceUntil(admin, userId)
      const cotaZerada = await zerarCotaSeCaiuParaGratis(admin, userId, 'free')
      await admin.from('subscriptions').upsert({
        user_id: userId,
        plan: 'free',
        status: 'free',
        billing_interval: null,
        cancel_at_period_end: false,
        current_period_end: null,
        stripe_subscription_id: null,
        ...(grace ? { partner_grace_until: grace } : {}),
        ...cotaZerada,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      return true
    }

    await syncSubscriptionToDb(current, userId)
    return true
  } catch (err) {
    console.error('[stripe-sync] reconcile falhou', err)
    return false
  }
}
