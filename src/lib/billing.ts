import { createClient, createAdminClient } from './supabase/server'

export { PLAN_LIMITS, PLAN_LABELS, planoQueLibera, formatarBytes, mensagemDeCota } from './planos-limites'
export type { PlanId, LimitesDoPlano } from './planos-limites'
import type { PlanId } from './planos-limites'

// Lê o plano da família do usuário autenticado via RPC SECURITY DEFINER.
export async function getFamilyPlan(): Promise<PlanId> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_family_plan')
  return (data as PlanId) ?? 'free'
}

export interface EffectiveSubscription {
  isOwner: boolean
  ownerId: string | null
  ownerName: string | null
  plan: PlanId
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  billingInterval: string | null
  partnerGraceUntil: string | null
  /**
   * Em teste E já com assinatura no Stripe — ou seja, a pessoa assinou durante
   * o período de testes e o cartão está guardado. Sem isto, os dois estados de
   * "trialing" eram indistinguíveis na tela: quem acabara de pagar via a mesma
   * mensagem de quem nunca tinha assinado, e concluía (com razão) que a
   * assinatura não havia funcionado.
   */
  assinouNoTeste: boolean
  /** v1 = modelo antigo (teste sem cartão); v2 = modelo novo (teste com cartão). */
  oferta: 'v1' | 'v2'
  pausedAt: string | null
  pauseReason: string | null
  deleteAfter: string | null
  paymentFailedAt: string | null
}

// Resolve a assinatura "efetiva" do usuário: a do OWNER da família ativa.
// O plano é sempre herdado do owner — então banner de trial, status e tela de
// planos devem refletir a assinatura do owner, não a do parceiro. Para o owner,
// é a própria assinatura.
export async function getEffectiveSubscription(): Promise<EffectiveSubscription> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()

  const empty: EffectiveSubscription = {
    isOwner: true, ownerId: null, ownerName: null,
    plan: 'free', status: 'free', trialEndsAt: null,
    assinouNoTeste: false,
    currentPeriodEnd: null, cancelAtPeriodEnd: false,
    billingInterval: null, partnerGraceUntil: null,
    oferta: 'v1', pausedAt: null, pauseReason: null, deleteAfter: null, paymentFailedAt: null,
  }
  if (!user) return empty

  // Família ativa e seu owner
  const { data: familyId } = await supabase.rpc('auth_family_id')
  let ownerId = user.id
  let ownerName: string | null = null
  if (familyId) {
    const { data: fam } = await supabase
      .from('families')
      .select('created_by, name')
      .eq('id', familyId)
      .maybeSingle()
    if (fam?.created_by) ownerId = fam.created_by
    ownerName = fam?.name ?? null
  }
  const isOwner = ownerId === user.id

  // Assinatura do owner (fonte de verdade do plano para toda a família)
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan, status, trial_ends_at, current_period_end, cancel_at_period_end, billing_interval, partner_grace_until, stripe_subscription_id, oferta, paused_at, pause_reason, delete_after, payment_failed_at')
    .eq('user_id', ownerId)
    .maybeSingle()

  return {
    isOwner,
    ownerId,
    ownerName,
    plan: (sub?.plan as PlanId) ?? 'free',
    status: sub?.status ?? 'free',
    trialEndsAt: sub?.trial_ends_at ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    billingInterval: sub?.billing_interval ?? null,
    partnerGraceUntil: sub?.partner_grace_until ?? null,
    assinouNoTeste: sub?.status === 'trialing' && !!sub?.stripe_subscription_id,
    oferta: sub?.oferta === 'v2' ? 'v2' : 'v1',
    pausedAt: sub?.paused_at ?? null,
    pauseReason: sub?.pause_reason ?? null,
    deleteAfter: sub?.delete_after ?? null,
    paymentFailedAt: sub?.payment_failed_at ?? null,
  }
}

// Retorna quantas capturas de IA o usuário já usou no mês corrente.
// Reseta automaticamente se o contador estiver de um mês anterior.
export async function getAiUsageThisMonth(userId: string): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('ai_uses_this_month, ai_uses_reset_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return 0

  const resetAt = new Date(data.ai_uses_reset_at)
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // Contador de mês anterior — considera como zero
  if (resetAt < startOfMonth) return 0
  return data.ai_uses_this_month ?? 0
}

// Soma o total de bytes armazenados no vault da família ativa do usuário logado.
// Usa o cliente com RLS — a query automaticamente retorna só os arquivos da família.
/**
 * Bytes já usados pela família, ou `null` se a medição falhar.
 *
 * ⚠️ O `null` é o ponto. Antes esta função devolvia 0 quando a RPC dava erro —
 * e zero usado significa "cabe tudo", então uma falha momentânea do banco
 * virava permissão de upload sem limite. Quem chama PRECISA tratar o `null`
 * como recusa, não como zero.
 */
export async function getFamilyStorageUsedBytes(): Promise<number | null> {
  const supabase = await createClient()
  // Soma no banco (RPC). Antes trazia todas as linhas de document_files e
  // somava aqui — o PostgREST corta a resposta em 1000 linhas por padrão, de
  // modo que uma família com mais de 1000 arquivos teria a cota SUBCONTADA e
  // conseguiria ultrapassar o limite do plano sem ser barrada.
  const { data, error } = await supabase.rpc('family_storage_used_bytes')
  if (error) {
    console.error('[billing] family_storage_used_bytes falhou:', error)
    return null
  }
  return Number(data ?? 0)
}

/**
 * Teto DIÁRIO de chamadas de IA por usuário, em todas as rotas que custam
 * dinheiro (Google Gemini, Anthropic e Groq).
 *
 * 50 é folgado para uso real — uma família não fotografa 50 documentos por
 * dia — e corta o caso que importa: script abusivo ou conta comprometida
 * chamando em laço. O limite mensal por plano (`aiPerMonth`) continua valendo
 * por cima; no pago ele é Infinity, então este era o único teto ausente.
 */
export const AI_CALLS_PER_DAY = 50

export interface CotaDiaria { permitido: boolean; usado: number; limite: number }

/**
 * Consome uma chamada e diz se ela pode prosseguir. ATÔMICO: incrementa e
 * devolve o novo valor numa instrução só, então chamadas paralelas não
 * ultrapassam o teto — problema que `incrementAiUsage` tem por ler e escrever
 * em duas idas ao banco.
 *
 * Falha ao contabilizar PERMITE a chamada: derrubar o recurso do usuário
 * legítimo por indisponibilidade do contador seria pior que o abuso que ele
 * evita. O oposto de `getFamilyStorageUsedBytes`, onde falhar aberto liberava
 * upload ilimitado — aqui o pior caso é uma chamada a mais.
 */
export async function consumirChamadaIa(userId: string): Promise<CotaDiaria> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('consume_ai_call', {
    p_user_id: userId,
    p_daily_limit: AI_CALLS_PER_DAY,
  })
  if (error) {
    console.error('[billing] consume_ai_call falhou:', { code: error.code })
    return { permitido: true, usado: 0, limite: AI_CALLS_PER_DAY }
  }
  return data as CotaDiaria
}

/** Mensagem única do 429, para as três rotas não divergirem. */
export function mensagemLimiteDiario(c: CotaDiaria): string {
  return `Você atingiu o limite de ${c.limite} usos de IA por dia. O contador zera amanhã.`
}

// Incrementa o contador de IA do mês. Reseta se for mês novo.
export async function incrementAiUsage(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('ai_uses_this_month, ai_uses_reset_at')
    .eq('user_id', userId)
    .maybeSingle()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const isNewMonth = !data || new Date(data.ai_uses_reset_at) < startOfMonth
  const newCount = isNewMonth ? 1 : (data.ai_uses_this_month ?? 0) + 1

  await admin.from('subscriptions').upsert({
    user_id: userId,
    ai_uses_this_month: newCount,
    ai_uses_reset_at: isNewMonth ? startOfMonth.toISOString() : undefined,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}
