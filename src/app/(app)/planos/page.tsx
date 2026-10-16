import { getEffectiveSubscription, getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'
import { stripe } from '@/lib/stripe'
import { precoPorMes } from '@/lib/planos-oferta'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { janelaArrependimento } from '@/lib/stripe-arrependimento'
import { createAdminClient } from '@/lib/supabase/server'
import PlanosClient from './PlanosClient'

export interface PlanPrices {
  familia: { monthly: number; yearly: number }
  plus:    { monthly: number; yearly: number }
}

export default async function PlanosPage() {
  // Resolve owner/parceiro primeiro.
  const pre = await getEffectiveSubscription()

  // Só o owner tem assinatura própria no Stripe para reconciliar.
  if (pre.isOwner && pre.ownerId) {
    await reconcileUserFromStripe(pre.ownerId)
  }

  // Para owner, relê após reconciliar (pode ter mudado vindo do Stripe).
  const eff = pre.isOwner ? await getEffectiveSubscription() : pre

  // Plano para gating/limites — getFamilyPlan já resolve owner mesmo para parceiro.
  // Preços da oferta vigente (planos-oferta.ts). Antes eram lidos dos preços
  // antigos do Stripe, que deixaram de ser vendidos em 16/10/2026.
  const plan = await getFamilyPlan()
  const prices: PlanPrices = {
    familia: { monthly: precoPorMes('familia', 'month'), yearly: precoPorMes('familia', 'year') },
    plus:    { monthly: precoPorMes('plus', 'month'),    yearly: precoPorMes('plus', 'year') },
  }
  // Plano cortesia (fundadores): plano pago gravado direto no banco, sem
  // cliente no Stripe. Não há assinatura para gerenciar, cancelar ou trocar.
  let cortesia = false

  // Janela de arrependimento (7 dias) — só o owner tem cobrança própria, e só
  // faz sentido consultar o Stripe se houver plano pago para desfazer.
  let arrependimentoAte: string | null = null
  if (eff.isOwner && eff.ownerId && plan !== 'free') {
    try {
      const admin = createAdminClient()
      const { data } = await admin.from('subscriptions')
        .select('stripe_customer_id').eq('user_id', eff.ownerId).maybeSingle()
      const cus = data?.stripe_customer_id as string | null | undefined
      if (!cus && eff.status === 'active') cortesia = true
      if (cus) {
        // Só as assinaturas vigentes: a janela tem que se referir ao que a
        // pessoa cancelaria agora, não a um plano antigo já encerrado.
        const vivas = await stripe.subscriptions.list({ customer: cus, status: 'all', limit: 20 })
        const vigentes = vivas.data.filter(s => s.status === 'active' || s.status === 'trialing')
        const ids = vigentes.map(s => s.id)
        const j = await janelaArrependimento(cus, ids)
        if (j.dentro) arrependimentoAte = j.prazo
      }
    } catch (e) {
      // Não é motivo para derrubar a tela de planos: sem o aviso, o
      // cancelamento ainda reembolsa — a rota reavalia a janela por conta.
      console.error('[planos] janela de arrependimento indisponível:', e)
    }
  }

  return (
    <PlanosClient
      arrependimentoAte={arrependimentoAte}
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
      prices={prices}
      cortesia={cortesia}
    />
  )
}
