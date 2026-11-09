// Conversões que só o Stripe confirma, enviadas à Meta pela API de Conversões.
// Chamado pelo webhook do Stripe. O navegador manda o mesmo evento quando vê o
// retorno do pagamento (MedicaoComConsentimento), com o MESMO event_id:
//   · início do teste → `trial_<id da assinatura>`
//   · compra          → `purchase_<id da fatura>`
// /api/stripe/return monta o event_id do navegador pela mesma regra
// (eventIdDaVolta). Mudar um lado sem o outro faz a Meta contar em dobro.

import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { enviarEventoMeta, dadosMetaDaAssinatura, metaCapiConfigurada } from '@/lib/meta-capi'

export const eventIdTeste = (subId: string) => `trial_${subId}`
export const eventIdCompra = (invoiceId: string) => `purchase_${invoiceId}`

// Desde a API 2026-05-27.dahlia o vínculo fatura→assinatura fica em
// `parent.subscription_details.subscription` (ver stripe-arrependimento.ts).
function subscriptionDaFatura(inv: Stripe.Invoice): string | null {
  const s = (inv as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } }
  }).parent?.subscription_details?.subscription
  if (typeof s === 'string') return s
  return s?.id ?? null
}

/** Assinatura recém-criada em teste grátis (checkout.session.completed). */
export async function metaInicioDoTeste(sub: Stripe.Subscription): Promise<void> {
  if (!metaCapiConfigurada() || sub.status !== 'trialing') return
  const meta = dadosMetaDaAssinatura(sub.metadata as Record<string, string>)
  if (!meta) return // sem aceite de cookies: nada vai para a Meta
  await enviarEventoMeta({
    nome: 'StartTrial',
    eventId: eventIdTeste(sub.id),
    quando: Math.floor(Date.now() / 1000),
    url: meta.url,
    usuario: meta.usuario,
    dados: { value: 0, currency: 'BRL', content_name: sub.metadata?.plan ?? '' },
  })
}

/**
 * Fatura paga (invoice.paid). Só a PRIMEIRA cobrança paga de cada assinatura
 * vira Purchase: é ela que mostra que o anúncio trouxe um cliente pagante.
 * Renovações mensais e diferenças de upgrade não contam de novo — a marca
 * `meta_purchase` na assinatura garante isso (e torna o webhook repetido inofensivo).
 */
export async function metaCompraDaFatura(inv: Stripe.Invoice): Promise<void> {
  if (!metaCapiConfigurada() || !inv.id || (inv.amount_paid ?? 0) <= 0) return
  const subId = subscriptionDaFatura(inv)
  if (!subId) return
  const sub = await stripe.subscriptions.retrieve(subId)
  const md = sub.metadata as Record<string, string>
  const meta = dadosMetaDaAssinatura(md)
  if (!meta || md.meta_purchase) return

  const pagoEm = (inv as unknown as { status_transitions?: { paid_at?: number | null } }).status_transitions?.paid_at
  const ok = await enviarEventoMeta({
    nome: 'Purchase',
    eventId: eventIdCompra(inv.id),
    quando: pagoEm ?? Math.floor(Date.now() / 1000),
    url: meta.url,
    usuario: meta.usuario,
    dados: { value: inv.amount_paid / 100, currency: (inv.currency ?? 'brl').toUpperCase(), content_name: md.plan ?? '' },
  })
  // Marca só se a Meta aceitou: se falhou, a próxima tentativa do webhook
  // (ou a próxima fatura) ainda envia.
  if (ok) await stripe.subscriptions.update(sub.id, { metadata: { meta_purchase: inv.id } })
}

/**
 * event_id que o navegador usa na volta do pagamento — a mesma regra dos
 * envios acima. Assinatura em teste → início do teste; paga → a fatura dela.
 */
export function eventIdDaVolta(sub: Stripe.Subscription): string | null {
  if (sub.status === 'trialing') return eventIdTeste(sub.id)
  const inv = sub.latest_invoice
  const invId = typeof inv === 'string' ? inv : inv?.id
  return invId ? eventIdCompra(invId) : null
}
