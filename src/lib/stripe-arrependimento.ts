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

/**
 * A qual assinatura a fatura pertence.
 *
 * ⚠️ `invoice.subscription` também deixou de existir na API 2026-05-27.dahlia.
 * O vínculo agora fica em `parent.subscription_details.subscription`.
 */
function subscriptionDaFatura(inv: Stripe.Invoice): string | null {
  const parent = (inv as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } }
  }).parent
  const s = parent?.subscription_details?.subscription
  if (typeof s === 'string') return s
  return s?.id ?? null
}

/**
 * Avalia se ainda estamos na janela de 7 dias da última cobrança real
 * **das assinaturas informadas**.
 *
 * ⚠️ `subscriptionIds` não é opcional por preguiça de tipo: sem ele o cálculo
 * erra feio. Um cliente que trocou de plano tem faturas de assinaturas
 * ANTIGAS, já canceladas, e a mais recente delas pode não ter nada a ver com
 * o que está sendo cancelado agora. Foi o que apareceu no teste real: a
 * assinatura viva era a anual de R$ 382,80, mas a última fatura elegível era
 * de R$ 59,90 — de um plano mensal encerrado. Sem o filtro, o reembolso sairia
 * com o valor errado, de uma cobrança que já não existia.
 */
export async function janelaArrependimento(
  customerId: string,
  subscriptionIds: string[],
): Promise<JanelaArrependimento> {
  if (subscriptionIds.length === 0) return VAZIA
  const doCliente = new Set(subscriptionIds)
  const lista = await stripe.invoices.list({ customer: customerId, status: 'paid', limit: 20 })

  const elegiveis = lista.data.filter(inv => {
    if (inv.amount_paid <= 0) return false
    if (typeof inv.billing_reason !== 'string') return false
    if (!MOTIVOS_QUE_ABREM_JANELA.includes(inv.billing_reason)) return false
    const sub = subscriptionDaFatura(inv)
    return sub !== null && doCliente.has(sub)
  })

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

/** O schedule que governa a assinatura, se houver. */
function scheduleDa(sub: Stripe.Subscription): string | null {
  const s = (sub as unknown as { schedule?: string | { id: string } }).schedule
  if (typeof s === 'string') return s
  return s?.id ?? null
}

/**
 * Agenda o fim da assinatura, por onde o Stripe permitir.
 *
 * ⚠️ POR QUE NÃO BASTA `subscriptions.update({ cancel_at_period_end })`
 * Quando a assinatura está sob um `subscription_schedule`, o Stripe RECUSA
 * qualquer alteração de cancelamento feita direto nela:
 *
 *   "The subscription is managed by the subscription schedule sub_sched_...,
 *    and updating any cancelation behavior directly is not allowed."
 *
 * Não é hipótese: apareceu no teste do H1. Encerrar o teste pelo painel do
 * Stripe ("End trial") cria um schedule, e a partir dali TODO cancelamento
 * pelo app falhava com 500 — o botão não fazia nada, sem nenhum sinal de
 * que o Stripe tinha recusado.
 *
 * Com schedule, o equivalente é soltar o schedule no fim do período
 * (`end_behavior: 'cancel'` via release não serve — precisamos cancelar).
 */
export async function agendarFimDaAssinatura(sub: Stripe.Subscription): Promise<void> {
  const sched = scheduleDa(sub)
  if (!sched) {
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true })
    return
  }
  // O schedule manda: dizer a ele para encerrar (em vez de renovar) no fim da
  // fase corrente é o que o Stripe aceita aqui.
  await stripe.subscriptionSchedules.update(sched, { end_behavior: 'cancel' })
}

/** Desfaz o agendamento de fim, pelo mesmo caminho. */
export async function reativarAssinatura(sub: Stripe.Subscription): Promise<void> {
  const sched = scheduleDa(sub)
  if (!sched) {
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false })
    return
  }
  await stripe.subscriptionSchedules.update(sched, { end_behavior: 'release' })
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
  customerId: string,
): Promise<{ reembolsado: number; creditoZerado: number }> {
  if (!janela.paymentIntentId) {
    throw new Error('Cobrança sem payment_intent — reembolso precisa ser feito no painel do Stripe')
  }

  // Reembolso primeiro. Se falhar, a assinatura NÃO é cancelada — é melhor a
  // pessoa continuar com o acesso que pagou do que perder acesso e dinheiro.
  await stripe.refunds.create({
    payment_intent: janela.paymentIntentId,
    reason: 'requested_by_customer',
  })

  // Mesmo impedimento do cancelamento agendado: com schedule ativo o Stripe
  // recusa encerrar a assinatura direto. `release` desfaz o vínculo sem mexer
  // na assinatura, e aí o cancelamento passa.
  for (const s of subs) {
    const sched = scheduleDa(s)
    if (sched) {
      await stripe.subscriptionSchedules.release(sched)
        .catch(e => console.error('[arrependimento] release do schedule falhou:', e))
    }
    await stripe.subscriptions.cancel(s.id)
  }

  const creditoZerado = await zerarCreditoDoCliente(customerId)
  return { reembolsado: janela.valorCentavos, creditoZerado }
}

/**
 * Zera o crédito do cliente depois do estorno — senão o dinheiro volta DUAS
 * vezes, em formas diferentes.
 *
 * O caso: assina o anual (R$ 382,80 no cartão), troca para o mensal dentro dos
 * 7 dias e o Stripe converte o tempo não usado em **crédito** (~R$ 342,90) em
 * vez de devolver ao cartão — comportamento normal de proração. Se logo em
 * seguida a pessoa cancelar, a janela ainda aponta para a cobrança original de
 * R$ 382,80, e o estorno sai integral. Resultado: R$ 382,80 de volta no cartão
 * **e** R$ 342,90 ainda parados na conta, que ela não pagou.
 *
 * Zerar aqui deixa a conta exata: ela recebe de volta o que pagou, uma vez só.
 *
 * Só mexe em saldo CREDOR (negativo no Stripe). Saldo devedor fica intocado —
 * perdoar dívida por causa de um estorno seria outro presente involuntário.
 */
async function zerarCreditoDoCliente(customerId: string): Promise<number> {
  const cus = await stripe.customers.retrieve(customerId)
  if ('deleted' in cus) return 0
  const saldo = cus.balance ?? 0
  if (saldo >= 0) return 0

  await stripe.customers.createBalanceTransaction(customerId, {
    // Positivo anula o crédito (que no Stripe é negativo).
    amount: -saldo,
    currency: cus.currency ?? 'brl',
    description: 'Crédito de proração anulado — valor devolvido ao cartão (arrependimento)',
  })
  console.warn('[arrependimento] crédito de R$ %s zerado após estorno', (-saldo / 100).toFixed(2))
  return -saldo
}
