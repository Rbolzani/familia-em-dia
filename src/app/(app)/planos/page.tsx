import { getEffectiveSubscription, getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { createAdminClient } from '@/lib/supabase/server'
import PlanosClient from './PlanosClient'

export default async function PlanosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Resolve owner/parceiro primeiro.
  const pre = await getEffectiveSubscription()

  // Só o owner tem assinatura própria no Stripe para reconciliar.
  if (pre.isOwner && pre.ownerId) {
    await reconcileUserFromStripe(pre.ownerId)
  }

  // Para owner, relê após reconciliar (pode ter mudado vindo do Stripe).
  const eff = pre.isOwner ? await getEffectiveSubscription() : pre

  // Plano para gating/limites — getFamilyPlan já resolve owner mesmo para parceiro.
  const plan = await getFamilyPlan()

  // Plano cortesia (fundadores): plano pago gravado direto no banco, sem
  // cliente no Stripe. Não há assinatura para gerenciar, cancelar ou trocar.
  let cortesia = false
  if (eff.isOwner && eff.ownerId && eff.status === 'active') {
    const { data } = await createAdminClient().from('subscriptions')
      .select('stripe_customer_id').eq('user_id', eff.ownerId).maybeSingle()
    cortesia = !data?.stripe_customer_id
  }

  const q = await searchParams

  return (
    <PlanosClient
      oferta={eff.oferta}
      assinouNoTeste={eff.assinouNoTeste}
      currentPlan={plan}
      status={eff.status}
      trialEndsAt={eff.trialEndsAt}
      currentPeriodEnd={eff.currentPeriodEnd}
      cancelAtPeriodEnd={eff.cancelAtPeriodEnd}
      billingInterval={eff.billingInterval}
      isOwner={eff.isOwner}
      ownerName={eff.ownerName}
      childLimit={PLAN_LIMITS[plan].children}
      aiLimit={PLAN_LIMITS[plan].aiPerMonth}
      cortesia={cortesia}
      pauseReason={eff.pauseReason}
      deleteAfter={eff.deleteAfter}
      paymentFailedAt={eff.paymentFailedAt}
      destacarCartao={q.acao === 'cartao'}
    />
  )
}
