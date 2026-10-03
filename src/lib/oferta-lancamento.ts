import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'

// Oferta de lançamento: os 20 primeiros assinantes do Família MENSAL pagam
// R$ 29,90/mês para sempre (R$ 10 de desconto sobre R$ 39,90), enquanto
// permanecerem no Família mensal.
//
// As vagas são contadas pelo próprio Stripe (max_redemptions do cupom), não
// pelo nosso banco: o limite vale no instante em que a assinatura nasce, sem
// corrida entre dois checkouts simultâneos.
//
// O cupom tem ID fixo e é criado na primeira consulta, com a mesma chave que
// o app já usa — por isso existe na conta de teste e passa a existir na LIVE
// sem passo manual no painel. Uma vaga é consumida quando a assinatura é
// criada (inclusive durante o teste grátis) e não volta se a pessoa cancelar.
export const CUPOM_LANCAMENTO = 'lancamento-familia'
export const VAGAS_LANCAMENTO = 20
const DESCONTO_CENTAVOS = 1000

export interface StatusOferta {
  ativa: boolean
  restantes: number
  total: number
  descontoReais: number
}

function codigo(e: unknown): string | undefined {
  return (e as { code?: string })?.code
}

async function obterCupom(): Promise<Stripe.Coupon | null> {
  try {
    return await stripe.coupons.retrieve(CUPOM_LANCAMENTO)
  } catch (e) {
    if (codigo(e) !== 'resource_missing') throw e
  }

  const priceId = process.env.STRIPE_PRICE_FAMILIA_MENSAL
  if (!priceId) return null
  const price = await stripe.prices.retrieve(priceId)
  const produto = typeof price.product === 'string' ? price.product : price.product.id

  try {
    return await stripe.coupons.create({
      id: CUPOM_LANCAMENTO,
      name: 'Oferta de lançamento — Família R$ 29,90',
      amount_off: DESCONTO_CENTAVOS,
      currency: price.currency,
      duration: 'forever',
      max_redemptions: VAGAS_LANCAMENTO,
      // Só o produto Família: numa troca para o Plus o desconto não acompanha.
      applies_to: { products: [produto] },
    })
  } catch (e) {
    // Outra requisição criou o cupom no mesmo instante.
    if (codigo(e) === 'resource_already_exists') return stripe.coupons.retrieve(CUPOM_LANCAMENTO)
    throw e
  }
}

export async function statusOferta(): Promise<StatusOferta> {
  const encerrada: StatusOferta = { ativa: false, restantes: 0, total: VAGAS_LANCAMENTO, descontoReais: DESCONTO_CENTAVOS / 100 }
  try {
    const cupom = await obterCupom()
    if (!cupom) return encerrada
    const total = cupom.max_redemptions ?? VAGAS_LANCAMENTO
    const restantes = Math.max(0, total - cupom.times_redeemed)
    return {
      ativa: cupom.valid && restantes > 0,
      restantes,
      total,
      descontoReais: (cupom.amount_off ?? DESCONTO_CENTAVOS) / 100,
    }
  } catch (e) {
    // Sem Stripe, a oferta simplesmente não aparece — nunca derruba o checkout.
    console.error('[oferta-lancamento]', e)
    return encerrada
  }
}
