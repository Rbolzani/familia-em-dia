import Stripe from 'stripe'
import { PRECOS_VIGENTES } from '@/lib/planos-oferta'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export type PlanId = 'free' | 'basico' | 'familia' | 'plus' | 'pausada'
export type PlanoPagoId = 'basico' | 'familia' | 'plus'
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

// ── Preços vigentes (oferta de 3 planos, aprovada em 20/10/2026) ─────────────
// Identificados pelo lookup_key: o app cria cada preço sozinho na primeira
// venda, tanto na conta de teste quanto na LIVE — sem env var na Vercel.
// Família e Plus vão para o produto que já existe (o do preço antigo, env
// STRIPE_PRICE_*); o Básico ganha um produto próprio, criado na primeira vez e
// reencontrado depois pela metadata `plan=basico`.
// Valores e lookup_keys moram em planos-oferta.ts (fonte única, sem servidor).

const cacheVigentes = new Map<string, string>()
const cacheProdutos = new Map<string, string>()

const NOME_PRODUTO: Record<PlanoPagoId, string> = {
  basico: 'Família em Dia - Plano Básico',
  familia: 'Família em Dia - Plano Família',
  plus: 'Família em Dia - Plano Plus',
}

/** Produto do Stripe de cada plano (cria o do Básico na primeira vez). */
export async function produtoDoPlano(plan: PlanoPagoId): Promise<string> {
  const emCache = cacheProdutos.get(plan)
  if (emCache) return emCache
  let id: string | undefined
  // 1) pelo preço antigo (Família e Plus têm)
  const antigoId = plan === 'basico' ? null : planToPrice(plan, 'month')
  if (antigoId) {
    const antigo = await stripe.prices.retrieve(antigoId)
    id = typeof antigo.product === 'string' ? antigo.product : antigo.product.id
  }
  // 2) pela metadata
  if (!id) {
    const achados = await stripe.products.search({ query: `metadata['plan']:'${plan}' AND active:'true'`, limit: 1 })
    id = achados.data[0]?.id
  }
  // 3) cria
  if (!id) {
    id = (await stripe.products.create({ name: NOME_PRODUTO[plan], metadata: { plan } })).id
  }
  cacheProdutos.set(plan, id)
  return id
}

// ID do preço vigente no Stripe; cria na primeira vez, no produto do plano.
export async function precoVigenteId(plan: PlanoPagoId, interval: BillingInterval): Promise<string | null> {
  const chave = `${plan}:${interval}` as const
  const emCache = cacheVigentes.get(chave)
  if (emCache) return emCache
  const { lookupKey, centavos } = PRECOS_VIGENTES[chave]
  const achar = async () => (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]?.id
  let id = await achar()
  if (!id) {
    const produto = await produtoDoPlano(plan)
    try {
      id = (await stripe.prices.create({
        product: produto,
        currency: 'brl',
        unit_amount: centavos,
        recurring: { interval },
        lookup_key: lookupKey,
        nickname: `${NOME_PRODUTO[plan].replace('Família em Dia - Plano ', '')} ${interval === 'month' ? 'mensal' : 'anual'} (nov/2026)`,
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

// Preços de out/2026 (Família R$ 19,90 · Plus R$ 29,90), substituídos pela
// oferta de 3 planos. Nunca tiveram assinante; continuam reconhecidos só para
// uma assinatura antiga, se existir, não virar "plano desconhecido".
const PRECOS_OUT_2026: Record<string, { plan: PlanId; interval: BillingInterval }> = {
  familia_mensal_2026_10: { plan: 'familia', interval: 'month' },
  familia_anual_2026_10:  { plan: 'familia', interval: 'year' },
  plus_mensal_2026_10:    { plan: 'plus',    interval: 'month' },
  plus_anual_2026_10:     { plan: 'plus',    interval: 'year' },
}

// Preços da antiga oferta de lançamento (encerrada em 16/10/2026 sem nenhuma
// assinatura). O app não vende mais por eles; continuam reconhecidos só para
// uma assinatura antiga, se existir, não virar "plano desconhecido".
export const PRECOS_LANCAMENTO: Record<'familia:month' | 'familia:year' | 'plus:month' | 'plus:year', { lookupKey: string; centavos: number }> = {
  'familia:month': { lookupKey: 'lancamento_familia_mensal', centavos: 2990 },   // R$ 39,90 → R$ 29,90
  'familia:year':  { lookupKey: 'lancamento_familia_anual',  centavos: 28680 },  // R$ 382,80 → R$ 286,80 (R$ 23,90/mês)
  'plus:month':    { lookupKey: 'lancamento_plus_mensal',    centavos: 4490 },   // R$ 59,90 → R$ 44,90
  'plus:year':     { lookupKey: 'lancamento_plus_anual',     centavos: 43080 },  // R$ 574,80 → R$ 430,80 (R$ 35,90/mês)
}

export function ehPrecoLancamento(price: Pick<Stripe.Price, 'lookup_key'> | null | undefined): boolean {
  return !!price?.lookup_key && Object.values(PRECOS_LANCAMENTO).some(p => p.lookupKey === price.lookup_key)
}

// Plano/intervalo de qualquer preço que o app vendeu — vigente, de out/2026, antigo ou de lançamento.
export function planoDoPreco(price: Pick<Stripe.Price, 'id' | 'lookup_key'>): { plan: PlanId; interval: BillingInterval } | null {
  const regular = priceToPlan(price.id)
  if (regular) return regular
  for (const [chave, p] of Object.entries(PRECOS_VIGENTES)) {
    if (p.lookupKey === price.lookup_key) {
      const [plan, interval] = chave.split(':') as [PlanId, BillingInterval]
      return { plan, interval }
    }
  }
  if (price.lookup_key && PRECOS_OUT_2026[price.lookup_key]) return PRECOS_OUT_2026[price.lookup_key]
  for (const [chave, p] of Object.entries(PRECOS_LANCAMENTO)) {
    if (p.lookupKey === price.lookup_key) {
      const [plan, interval] = chave.split(':') as [PlanId, BillingInterval]
      return { plan, interval }
    }
  }
  return null
}
