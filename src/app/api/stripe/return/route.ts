import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { stripe } from '@/lib/stripe'
import { verificarCartaoDoTeste } from '@/lib/oferta-v2'
import { avisarInicioDoTeste } from '@/lib/avisos-conta'

/**
 * Volta do Checkout do Stripe: sincroniza o plano e manda para o Início.
 *
 * POR QUE ISTO EXISTE
 * Quem termina de pagar antes de o webhook chegar veria o app no estado
 * antigo logo depois de pagar. Esta rota reconcilia com o Stripe aqui, onde
 * só roda no retorno do pagamento, e entrega o Início.
 *
 * Modelo novo (teste com cartão): antes de entregar o app, confere se o cartão
 * já abriu um teste em outra conta (um teste por cartão). Se sim, o teste é
 * cancelado antes de qualquer cobrança e a pessoa vê "Assinar sem teste" (T5).
 * Se não, sai a confirmação do teste por e-mail (E1, exigência da Visa).
 */
// Põe no endereço de destino o que a medição precisa para registrar a compra
// (plano, período e valor). Falhar aqui não importa: a pessoa segue para o
// Início do mesmo jeito, só sem o evento.
async function anexarCompra(destino: URL, userId: string) {
  try {
    const { data } = await createAdminClient().from('subscriptions')
      .select('plan, billing_interval, stripe_subscription_id, status').eq('user_id', userId).maybeSingle()
    const subId = data?.stripe_subscription_id as string | null | undefined
    if (!subId || !data?.plan || data.plan === 'free') return
    const sub = await stripe.subscriptions.retrieve(subId)
    const centavos = sub.items.data[0]?.price?.unit_amount ?? 0
    destino.searchParams.set('assinou', `${data.plan}-${data.billing_interval === 'year' ? 'anual' : 'mensal'}`)
    // Em teste não houve cobrança: o valor da compra é zero hoje.
    destino.searchParams.set('valor', (data.status === 'trialing' ? 0 : centavos / 100).toFixed(2))
  } catch (e) {
    console.error('[stripe-return] dados da compra para medição indisponíveis:', (e as { code?: string })?.code)
  }
}

export async function GET(request: Request) {
  const destino = new URL('/dashboard', request.url)
  const sessionId = new URL(request.url).searchParams.get('session_id')

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // Conferência do cartão do teste (modelo novo) — antes da reconciliação,
      // para a conta nunca aparecer "em teste" com um cartão repetido.
      if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
        const session = await stripe.checkout.sessions.retrieve(sessionId)
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
        if (subId && session.client_reference_id === user.id) {
          const sub = await stripe.subscriptions.retrieve(subId, { expand: ['default_payment_method'] })
          const r = await verificarCartaoDoTeste(sub, user.id)
          if (r === 'cartao_ja_usado') return NextResponse.redirect(new URL('/assinar?cartao=usado', request.url))
        }
      }
      await reconcileUserFromStripe(user.id)
      await avisarInicioDoTeste(user.id).catch(e => console.error('[stripe-return] confirmação do teste:', e))
      await anexarCompra(destino, user.id)
    }
  } catch (e) {
    // Falhar aqui não pode prender a pessoa numa tela de erro depois de pagar:
    // o webhook e a reconciliação de /planos ainda corrigem o estado.
    console.error('[stripe-return] reconciliação falhou:', e)
  }

  return NextResponse.redirect(destino)
}
