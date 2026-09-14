import { getEffectiveSubscription, getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'
import { stripe } from '@/lib/stripe'
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
  const [plan, prices] = await Promise.all([
    getFamilyPlan(),
    (async (): Promise<PlanPrices> => {
      const ids = [
        process.env.STRIPE_PRICE_FAMILIA_MENSAL!,
        process.env.STRIPE_PRICE_FAMILIA_ANUAL!,
        process.env.STRIPE_PRICE_PLUS_MENSAL!,
        process.env.STRIPE_PRICE_PLUS_ANUAL!,
      ]
      const fetched = await Promise.all(ids.map(id => stripe.prices.retrieve(id)))
      const cents = (p: typeof fetched[0]) => (p.unit_amount ?? 0) / 100
      return {
        familia: { monthly: cents(fetched[0]), yearly: cents(fetched[1]) / 12 },
        plus:    { monthly: cents(fetched[2]), yearly: cents(fetched[3]) / 12 },
      }
    })(),
  ])

  // Janela de arrependimento (7 dias) — só o owner tem cobrança própria, e só
  // faz sentido consultar o Stripe se houver plano pago para desfazer.
  let arrependimentoAte: string | null = null
  if (eff.isOwner && eff.ownerId && plan !== 'free') {
    try {
      const admin = createAdminClient()
      const { data } = await admin.from('subscriptions')
        .select('stripe_customer_id').eq('user_id', eff.ownerId).maybeSingle()
      const cus = data?.stripe_customer_id as string | null | undefined
      if (cus) {
        const j = await janelaArrependimento(cus)
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
    />
  )
}
