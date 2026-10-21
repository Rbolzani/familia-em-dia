// Server-only: regras do modelo novo (oferta v2 — teste de 14 dias com cartão,
// 3 planos, sem gratuito). Aprovado pelo Rogério em 20/10/2026.
//
// Estados de `subscriptions.status` no modelo novo:
//   incompleto → conta criada, cartão ainda não cadastrado (só vê /assinar)
//   trialing   → teste de 14 dias com assinatura no Stripe
//   active     → pagando
//   past_due   → cartão recusado; 7 dias de carência com acesso normal
//   paused     → sem assinatura válida (cancelou e o período acabou, ou cartão
//                não regularizado em 7 dias). Só leitura; apagada em 90 dias.

import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from '@/lib/billing'

export const DIAS_CARENCIA_CARTAO = 7
export const DIAS_ATE_APAGAR = 90

type Admin = ReturnType<typeof createAdminClient>

/** A conta segue o modelo novo? (campo gravado pelo gatilho do cadastro novo) */
export async function ehContaV2(userId: string, admin: Admin = createAdminClient()): Promise<boolean> {
  const { data } = await admin.from('subscriptions').select('oferta').eq('user_id', userId).maybeSingle()
  return data?.oferta === 'v2'
}

// ── Um teste grátis por cartão ──────────────────────────────────────────────
// O Stripe dá a cada cartão uma "impressão" (fingerprint) que não revela o
// número e é igual em qualquer conta. Se o cartão já abriu um teste em outra
// conta, a assinatura recém-criada (em teste) é cancelada ANTES de qualquer
// cobrança e a pessoa vê a escolha "Assinar sem teste" (T5).

async function impressaoDoCartao(sub: Stripe.Subscription): Promise<string | null> {
  let pm = sub.default_payment_method
  if (typeof pm === 'string') pm = await stripe.paymentMethods.retrieve(pm)
  if (!pm) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const c = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] })
    const dpm = (c as Stripe.Customer).invoice_settings?.default_payment_method
    pm = dpm && typeof dpm !== 'string' ? dpm : null
  }
  return pm?.card?.fingerprint ?? null
}

/**
 * Confere o cartão de uma assinatura em teste do modelo novo. Idempotente
 * (`trial_card_checked`). Devolve 'cartao_ja_usado' quando cancelou o teste.
 */
export async function verificarCartaoDoTeste(sub: Stripe.Subscription, userId: string): Promise<'ok' | 'cartao_ja_usado' | 'nao_se_aplica'> {
  if (sub.status !== 'trialing') return 'nao_se_aplica'
  const admin = createAdminClient()
  const { data: row } = await admin.from('subscriptions').select('oferta, trial_card_checked').eq('user_id', userId).maybeSingle()
  if (row?.oferta !== 'v2' || row.trial_card_checked) return 'nao_se_aplica'

  const fp = await impressaoDoCartao(sub)
  if (!fp) return 'nao_se_aplica'  // sem cartão identificável: o Stripe cancela o teste sozinho se faltar cartão

  const { data: dono } = await admin.from('trial_cartoes').select('user_id').eq('fingerprint', fp).maybeSingle()
  if (dono && dono.user_id !== userId) {
    // Marca o motivo antes de cancelar: a sincronização vê e devolve a conta
    // para "incompleto" (não para "pausada").
    await stripe.subscriptions.update(sub.id, { metadata: { ...sub.metadata, motivo_fim: 'cartao_ja_usado' } })
    await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false })
    await admin.from('subscriptions').update({
      status: 'incompleto', stripe_subscription_id: null, trial_ends_at: null,
      trial_card_checked: false, updated_at: new Date().toISOString(),
    }).eq('user_id', userId)
    return 'cartao_ja_usado'
  }
  await admin.from('trial_cartoes').upsert({ fingerprint: fp, user_id: userId }, { onConflict: 'fingerprint', ignoreDuplicates: true })
  await admin.from('subscriptions').update({ trial_card_checked: true }).eq('user_id', userId)
  return 'ok'
}

// ── Mudar para um plano menor com itens acima do limite (T14) ────────────────

export interface AjusteNecessario { filhosRemover: number; parceirosRemover: string[] }

/** O que precisa sair da conta antes de mudar para `alvo`. null = nada. */
export async function ajustesParaPlano(ownerId: string, alvo: PlanId): Promise<AjusteNecessario | null> {
  const admin = createAdminClient()
  const { data: fam } = await admin.from('families').select('id').eq('created_by', ownerId).maybeSingle()
  if (!fam?.id) return null
  const lim = PLAN_LIMITS[alvo]
  const [{ count: filhos }, { data: parceiros }] = await Promise.all([
    admin.from('children').select('id', { count: 'exact', head: true }).eq('family_id', fam.id),
    admin.from('family_members').select('user_id, display_name').eq('family_id', fam.id).eq('role', 'partner'),
  ])
  const filhosRemover = Math.max(0, (filhos ?? 0) - lim.children)
  const excedentes = (parceiros ?? []).slice(Number.isFinite(lim.partners) ? lim.partners : Infinity)
  let nomes: string[] = []
  if (excedentes.length) {
    nomes = await Promise.all(excedentes.map(async p => {
      if (p.display_name) return p.display_name as string
      const { data } = await admin.auth.admin.getUserById(p.user_id as string)
      return data.user?.email ?? 'uma pessoa'
    }))
  }
  if (!filhosRemover && !nomes.length) return null
  return { filhosRemover, parceirosRemover: nomes }
}

/** Frases do T14. */
export function textoAjustes(alvo: PlanId, a: AjusteNecessario): string[] {
  const nome = PLAN_LABELS[alvo]
  const itens: string[] = []
  if (a.filhosRemover) itens.push(`remova ${a.filhosRemover} filho${a.filhosRemover > 1 ? 's' : ''} (o ${nome} tem até ${PLAN_LIMITS[alvo].children})`)
  for (const n of a.parceirosRemover) itens.push(`remova o acesso de ${n} (${PLAN_LIMITS[alvo].partners === 0 ? `o ${nome} não tem rede de apoio` : `o ${nome} inclui você + ${PLAN_LIMITS[alvo].partners} pessoa`})`)
  return itens
}
