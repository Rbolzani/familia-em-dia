import { createAdminClient } from '@/lib/supabase/server'
import { stripe, priceToPlan } from '@/lib/stripe'
import type Stripe from 'stripe'

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

  const priceId = sub.items?.data?.[0]?.price?.id
  const mapped = priceId ? priceToPlan(priceId) : null
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id

  const isEnded = sub.status === 'canceled' || sub.status === 'incomplete_expired'

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
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    ...graceField,
    ...cotaZerada,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

// Escolhe a assinatura "vigente" entre as do cliente:
// 1) ativa/trial e NÃO cancelando  → é a assinatura efetiva
// 2) ativa/trial cancelando         → ainda dá acesso até o fim do período
// 3) a mais recente                 → fallback (canceladas, etc.)
function pickCurrentSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subs.length === 0) return null
  const live = subs.filter(s => s.status === 'active' || s.status === 'trialing')
  const notCancelling = live.find(s => !s.cancel_at_period_end)
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
    .select('stripe_customer_id')
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
