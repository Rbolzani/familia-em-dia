import type Stripe from 'stripe'
import { stripe, planToPrice, planoDoPreco, ehPrecoLancamento, PRECOS_LANCAMENTO, type PlanId, type BillingInterval } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/server'

// Oferta de lançamento: os 20 primeiros assinantes têm ~25% de desconto para
// sempre, em qualquer plano e ciclo (R$ 29,90 · R$ 23,90 · R$ 44,90 · R$ 35,90
// por mês). Trocar de plano mantém o desconto.
//
// Preços redondos exigem preços próprios no Stripe — um cupom de 25% cobraria
// R$ 29,92. Por isso as vagas são contadas no banco
// (MIGRATION_oferta_lancamento.sql): reservadas ao abrir o checkout,
// confirmadas quando a assinatura nasce, devolvidas sozinhas se o checkout
// for abandonado — ou se a pessoa cancelar ainda no teste grátis, antes de
// qualquer cobrança. Depois da primeira cobrança a vaga não volta mais.
export const VAGAS_LANCAMENTO = 20
export const DESCONTO_LANCAMENTO_PCT = 25
// Um pouco mais que a validade do checkout (31 min), para a reserva não
// vencer com a pessoa ainda na tela de pagamento.
const RESERVA_MINUTOS = 35
export const CHECKOUT_LANCAMENTO_SEGUNDOS = 31 * 60

type Chave = keyof typeof PRECOS_LANCAMENTO
type PlanoPago = Exclude<PlanId, 'free'>

export interface StatusOferta {
  ativa: boolean
  restantes: number
  total: number
  /** Preço de lançamento por mês, em reais, para exibição. */
  precos: Record<PlanoPago, { monthly: number; yearly: number }>
}

const PRECOS_EXIBICAO: StatusOferta['precos'] = {
  familia: { monthly: PRECOS_LANCAMENTO['familia:month'].centavos / 100, yearly: PRECOS_LANCAMENTO['familia:year'].centavos / 1200 },
  plus:    { monthly: PRECOS_LANCAMENTO['plus:month'].centavos / 100,    yearly: PRECOS_LANCAMENTO['plus:year'].centavos / 1200 },
}

const cache = new Map<Chave, string>()

// ID do preço de lançamento do Stripe; cria na primeira vez, no mesmo
// produto e moeda do preço regular correspondente.
export async function precoLancamentoId(plan: PlanoPago, interval: BillingInterval): Promise<string | null> {
  const chave = `${plan}:${interval}` as Chave
  const emCache = cache.get(chave)
  if (emCache) return emCache
  const { lookupKey, centavos } = PRECOS_LANCAMENTO[chave]

  const achar = async () => (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]?.id
  let id = await achar()
  if (!id) {
    const regularId = planToPrice(plan, interval)
    if (!regularId) return null
    const regular = await stripe.prices.retrieve(regularId)
    const produto = typeof regular.product === 'string' ? regular.product : regular.product.id
    try {
      id = (await stripe.prices.create({
        product: produto,
        currency: regular.currency,
        unit_amount: centavos,
        recurring: { interval },
        lookup_key: lookupKey,
        nickname: `Lançamento — ${plan === 'familia' ? 'Família' : 'Plus'} ${interval === 'month' ? 'mensal' : 'anual'}`,
        metadata: { oferta: 'lancamento', plan, interval },
      })).id
    } catch (e) {
      // Outra requisição criou no mesmo instante (lookup_key é único).
      id = await achar()
      if (!id) throw e
    }
  }
  cache.set(chave, id)
  return id
}

export type ResultadoReserva = 'reservada' | 'confirmada' | 'esgotada'

export async function reservarVaga(userId: string): Promise<ResultadoReserva | null> {
  const { data, error } = await createAdminClient().rpc('reservar_vaga_lancamento', {
    p_user: userId, p_total: VAGAS_LANCAMENTO, p_minutos: RESERVA_MINUTOS,
  })
  if (error) { console.error('[oferta-lancamento] reserva falhou:', error.message); return null }
  return data as ResultadoReserva
}

/**
 * Antes de reativar uma assinatura cancelada NO TESTE: a vaga dela voltou para
 * a fila no cancelamento (ver stripe-sync.ts), então precisa de outra. Se as 20
 * já foram tomadas nesse meio-tempo, a assinatura passa para o preço regular —
 * e ainda não houve cobrança nenhuma, então nada precisa ser acertado.
 *
 * Nunca impede a reativação: falha de banco ou do Stripe aqui só mantém o
 * preço como está.
 */
export async function garantirVagaParaReativar(sub: Stripe.Subscription, userId: string): Promise<void> {
  const item = sub.items.data[0]
  if (sub.status !== 'trialing' || !item || !ehPrecoLancamento(item.price)) return
  try {
    if ((await reservarVaga(userId)) !== 'esgotada') return
    const info = planoDoPreco(item.price)
    const regular = info ? planToPrice(info.plan, info.interval) : null
    if (!regular) return
    await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: regular }], proration_behavior: 'none' })
    console.warn('[oferta-lancamento] reativação sem vaga: assinatura %s foi para o preço regular', sub.id)
  } catch (e) {
    console.error('[oferta-lancamento] vaga na reativação falhou:', (e as { code?: string })?.code)
  }
}

/** Situação da vaga de uma pessoa: já é dela (confirmada), reservada agora, ou nenhuma. */
export async function vagaDoUsuario(userId: string): Promise<'confirmada' | 'reservada' | null> {
  const { data } = await createAdminClient()
    .from('oferta_lancamento_vagas')
    .select('status, reservada_ate')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return null
  if (data.status === 'confirmada') return 'confirmada'
  return data.reservada_ate && new Date(data.reservada_ate).getTime() > Date.now() ? 'reservada' : null
}

export async function statusOferta(): Promise<StatusOferta> {
  const { data, error } = await createAdminClient().rpc('vagas_lancamento_usadas')
  if (error) {
    // Sem a contagem, a oferta não aparece — nunca derruba a tela de planos.
    console.error('[oferta-lancamento] contagem falhou:', error.message)
    return { ativa: false, restantes: 0, total: VAGAS_LANCAMENTO, precos: PRECOS_EXIBICAO }
  }
  const restantes = Math.max(0, VAGAS_LANCAMENTO - (data as number))
  return { ativa: restantes > 0, restantes, total: VAGAS_LANCAMENTO, precos: PRECOS_EXIBICAO }
}
