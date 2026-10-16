import Stripe from 'stripe'
import { PRECOS_VIGENTES } from '@/lib/planos-oferta'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export type PlanId = 'free' | 'familia' | 'plus'
export type BillingInterval = 'month' | 'year'

// Mapa price_id → { plano, intervalo }. Usado pelo webhook para
// traduzir o preço que o cliente assinou no plano interno.
export function priceToPlan(priceId: string): { plan: PlanId; interval: BillingInterval } | null {
  switch (priceId) {
    case process.env.STRIPE_PRICE_FAMILIA_MENSAL:
      return { plan: 'familia', interval: 'month' }
    case process.env.STRIPE_PRICE_FAMILIA_ANUAL:
      return { plan: 'familia', interval: 'year' }
    case process.env.STRIPE_PRICE_PLUS_MENSAL:
      return { plan: 'plus', interval: 'month' }
    case process.env.STRIPE_PRICE_PLUS_ANUAL:
      return { plan: 'plus', interval: 'year' }
    default:
      return null
  }
}

// Mapa inverso: (plano, intervalo) → price_id. Usado pelo checkout.
export function planToPrice(plan: PlanId, interval: BillingInterval): string | null {
  const map: Record<string, string | undefined> = {
    'familia:month': process.env.STRIPE_PRICE_FAMILIA_MENSAL,
    'familia:year': process.env.STRIPE_PRICE_FAMILIA_ANUAL,
    'plus:month': process.env.STRIPE_PRICE_PLUS_MENSAL,
    'plus:year': process.env.STRIPE_PRICE_PLUS_ANUAL,
  }
  return map[`${plan}:${interval}`] ?? null
}

export const TRIAL_DAYS = 14

// ── Preços vigentes (desde 16/10/2026) ───────────────────────────────────────
// Identificados pelo lookup_key, como os de lançamento: o app cria cada preço
// sozinho na primeira venda, no mesmo produto do preço antigo, tanto na conta
// de teste quanto na LIVE — sem trocar env var na Vercel. Os preços antigos
// (env STRIPE_PRICE_*) continuam reconhecidos por priceToPlan.
// Valores e lookup_keys moram em planos-oferta.ts (fonte única, sem servidor).

const cacheVigentes = new Map<string, string>()

// ID do preço vigente no Stripe; cria na primeira vez, no produto do preço antigo.
export async function precoVigenteId(plan: Exclude<PlanId, 'free'>, interval: BillingInterval): Promise<string | null> {
  const chave = `${plan}:${interval}` as const
  const emCache = cacheVigentes.get(chave)
  if (emCache) return emCache
  const { lookupKey, centavos } = PRECOS_VIGENTES[chave]
  const achar = async () => (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]?.id
  let id = await achar()
  if (!id) {
    const antigoId = planToPrice(plan, interval)
    if (!antigoId) return null
    const antigo = await stripe.prices.retrieve(antigoId)
    const produto = typeof antigo.product === 'string' ? antigo.product : antigo.product.id
    try {
      id = (await stripe.prices.create({
        product: produto,
        currency: antigo.currency,
        unit_amount: centavos,
        recurring: { interval },
        lookup_key: lookupKey,
        nickname: `${plan === 'familia' ? 'Família' : 'Plus'} ${interval === 'month' ? 'mensal' : 'anual'} (out/2026)`,
        metadata: { plan, interval },
      })).id
    } catch (e) {
      // Outra requisição criou no mesmo instante (lookup_key é único).
      id = await achar()
      if (!id) throw e
    }
  }
  cacheVigentes.set(chave, id)
  return id
}

// Preços da oferta de lançamento (~25% para sempre, em qualquer plano).
// Identificados pelo lookup_key — e não por env var — porque o app os cria
// sozinho (ver oferta-lancamento.ts), tanto na conta de teste quanto na LIVE.
export const PRECOS_LANCAMENTO: Record<`${Exclude<PlanId, 'free'>}:${BillingInterval}`, { lookupKey: string; centavos: number }> = {
  'familia:month': { lookupKey: 'lancamento_familia_mensal', centavos: 2990 },   // R$ 39,90 → R$ 29,90
  'familia:year':  { lookupKey: 'lancamento_familia_anual',  centavos: 28680 },  // R$ 382,80 → R$ 286,80 (R$ 23,90/mês)
  'plus:month':    { lookupKey: 'lancamento_plus_mensal',    centavos: 4490 },   // R$ 59,90 → R$ 44,90
  'plus:year':     { lookupKey: 'lancamento_plus_anual',     centavos: 43080 },  // R$ 574,80 → R$ 430,80 (R$ 35,90/mês)
}

export function ehPrecoLancamento(price: Pick<Stripe.Price, 'lookup_key'> | null | undefined): boolean {
  return !!price?.lookup_key && Object.values(PRECOS_LANCAMENTO).some(p => p.lookupKey === price.lookup_key)
}

// Plano/intervalo de qualquer preço que o app vende — vigente, antigo ou de lançamento.
export function planoDoPreco(price: Pick<Stripe.Price, 'id' | 'lookup_key'>): { plan: PlanId; interval: BillingInterval } | null {
  const regular = priceToPlan(price.id)
  if (regular) return regular
  for (const [chave, p] of Object.entries(PRECOS_VIGENTES)) {
    if (p.lookupKey === price.lookup_key) {
      const [plan, interval] = chave.split(':') as [PlanId, BillingInterval]
      return { plan, interval }
    }
  }
  for (const [chave, p] of Object.entries(PRECOS_LANCAMENTO)) {
    if (p.lookupKey === price.lookup_key) {
      const [plan, interval] = chave.split(':') as [PlanId, BillingInterval]
      return { plan, interval }
    }
  }
  return null
}
