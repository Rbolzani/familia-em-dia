import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { syncSubscriptionToDb } from '@/lib/stripe-sync'
import { verificarCartaoDoTeste } from '@/lib/oferta-v2'
import { avisarInicioDoTeste } from '@/lib/avisos-conta'
import type Stripe from 'stripe'

export async function POST(request: Request) {
  const body = await request.text()
  const sig = (await headers()).get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Assinatura ausente' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret)
  } catch (err) {
    console.error('[stripe-webhook] falha na verificação:', err)
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscriptionToDb(event.data.object as Stripe.Subscription)
        break

      case 'checkout.session.completed': {
        // Garante sync imediato caso o evento de subscription chegue depois
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const subId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id
          const sub = await stripe.subscriptions.retrieve(subId, { expand: ['default_payment_method'] })
          // Modelo novo: um teste por cartão — confere antes de liberar (a
          // mesma conferência roda no retorno do Checkout; é idempotente).
          const userId = session.client_reference_id ?? sub.metadata?.user_id
          if (userId && (await verificarCartaoDoTeste(sub, userId)) === 'cartao_ja_usado') break
          await syncSubscriptionToDb(sub)
          if (userId) await avisarInicioDoTeste(userId).catch(e => console.error('[stripe-webhook] confirmação do teste:', e))
        }
        break
      }

      default:
        // Outros eventos ignorados
        break
    }
  } catch (err) {
    console.error('[stripe-webhook] erro ao processar', event.type, err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
