import { stripe } from '@/lib/stripe'
import type Stripe from 'stripe'

/**
 * Direito de arrependimento — CDC art. 49.
 *
 * Compra feita fora do estabelecimento (internet) pode ser desfeita em até 7
 * dias, com devolução do que foi pago. Não é liberalidade nossa: é lei, e os
 * Termos de Uso já prometem isso desde antes desta implementação — o app é
 * que não cumpria. Não havia nenhuma rota de reembolso no projeto.
 */
export const DIAS_ARREPENDIMENTO = 7

/**
 * Quais cobranças abrem a janela — e esta é a decisão que mais pesa aqui.
 *
 *  · `subscription_create` — a contratação em si. Óbvio.
 *  · `subscription_update` — troca de plano que gerou cobrança nova. Quem sai
 *    do mensal para o anual paga centenas de reais naquele instante; é uma
 *    contratação nova para todos os efeitos que importam.
 *  · `subscription_cycle` — **de fora, de propósito**. Renovação não é nova
 *    contratação, é continuação do mesmo contrato. Incluí-la daria a qualquer
 *    assinante 7 dias grátis por mês, todo mês: bastaria cancelar e reassinar.
 *
 * O prazo conta da cobrança, não do começo da assinatura — senão quem faz
 * upgrade para o anual meses depois ficaria sem direito nenhum sobre um valor
 * que acabou de sair do cartão.
 */
const MOTIVOS_QUE_ABREM_JANELA = ['subscription_create', 'subscription_update']

export interface JanelaArrependimento {
  dentro: boolean
  /** Fim da janela, ISO. Null quando não há cobrança elegível. */
  prazo: string | null
  /** Quanto seria devolvido, em centavos. */
  valorCentavos: number
  invoiceId: string | null
  paymentIntentId: string | null
}

const VAZIA: JanelaArrependimento = {
  dentro: false, prazo: null, valorCentavos: 0, invoiceId: null, paymentIntentId: null,
}

/** Avalia se o cliente ainda está na janela de 7 dias da última cobrança real. */
export async function janelaArrependimento(customerId: string): Promise<JanelaArrependimento> {
  const lista = await stripe.invoices.list({ customer: customerId, status: 'paid', limit: 20 })

  const elegiveis = lista.data.filter(inv =>
    inv.amount_paid > 0 &&
    typeof inv.billing_reason === 'string' &&
    MOTIVOS_QUE_ABREM_JANELA.includes(inv.billing_reason))

  if (elegiveis.length === 0) return VAZIA

  const inv = elegiveis.sort((a, b) => b.created - a.created)[0]
  const fim = (inv.created + DIAS_ARREPENDIMENTO * 86_400) * 1000

  return {
    ...VAZIA,
    dentro: Date.now() <= fim,
    prazo: new Date(fim).toISOString(),
    valorCentavos: inv.amount_paid,
    invoiceId: inv.id ?? null,
    paymentIntentId: await resolvePaymentIntent(inv.id),
  }
}

/**
 * Descobre o `payment_intent` que pagou a fatura.
 *
 * ⚠️ Não leia `invoice.payment_intent` — na API `2026-05-27.dahlia` esse campo
 * **não existe mais**. O pagamento migrou para `invoice.payments[].payment`, e
 * só vem com `expand`. Verificado contra uma fatura real: a leitura antiga
 * devolvia `undefined`, o que faria o reembolso falhar exatamente no momento
 * em que importa — com a pessoa esperando o dinheiro de volta.
 */
async function resolvePaymentIntent(invoiceId: string | null | undefined): Promise<string | null> {
  if (!invoiceId) return null
  const inv = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] })
  const pagamentos = (inv as unknown as {
    payments?: { data?: { payment?: { payment_intent?: string | { id: string } } }[] }
  }).payments?.data ?? []
  for (const p of pagamentos) {
    const pi = p.payment?.payment_intent
    if (typeof pi === 'string') return pi
    if (pi?.id) return pi.id
  }
  return null
}

/**
 * Devolve o valor e encerra a assinatura NA HORA.
 *
 * Arrependimento não é "cancelar no fim do período": o dinheiro volta, então o
 * acesso termina junto. Manter o acesso depois de devolver o pagamento seria
 * entregar o serviço de graça.
 */
export async function reembolsarEEncerrar(
  janela: JanelaArrependimento,
  subs: Stripe.Subscription[],
): Promise<{ reembolsado: number }> {
  if (!janela.paymentIntentId) {
    throw new Error('Cobrança sem payment_intent — reembolso precisa ser feito no painel do Stripe')
  }

  // Reembolso primeiro. Se falhar, a assinatura NÃO é cancelada — é melhor a
  // pessoa continuar com o acesso que pagou do que perder acesso e dinheiro.
  await stripe.refunds.create({
    payment_intent: janela.paymentIntentId,
    reason: 'requested_by_customer',
  })

  await Promise.all(subs.map(s => stripe.subscriptions.cancel(s.id)))

  return { reembolsado: janela.valorCentavos }
}
