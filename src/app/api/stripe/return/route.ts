import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { createAdminClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

/**
 * Volta do Checkout do Stripe: sincroniza o plano e manda para o Início.
 *
 * POR QUE ISTO EXISTE
 * O `success_url` apontava para `/configuracoes`, e não por acaso: aquela
 * página chama `reconcileUserFromStripe` ao carregar, que lê o estado real no
 * Stripe e corrige o banco. Sem isso, quem terminasse de pagar antes de o
 * webhook chegar veria o app ainda no plano gratuito — logo depois de ter
 * pago, que é o pior momento possível para o produto parecer quebrado.
 *
 * Mas cair em "Compartilhar acesso" depois de assinar não faz sentido nenhum
 * para quem acabou de entrar. Esta rota separa as duas coisas: reconcilia
 * aqui, onde só roda no retorno do pagamento, e entrega o Início.
 *
 * Não dá para simplesmente reconciliar dentro do dashboard: ele é a tela mais
 * visitada do app, e isso viraria uma chamada ao Stripe a cada abertura.
 */
// Põe no endereço de destino o que a medição precisa para registrar a compra
// (plano, período e valor). Nada disso é sensível, e o componente de medição
// tira os parâmetros da barra de endereço logo que lê. Falhar aqui não importa:
// a pessoa segue para o Início do mesmo jeito, só sem o evento de compra.
async function anexarCompra(destino: URL, userId: string) {
  try {
    const { data } = await createAdminClient().from('subscriptions')
      .select('plan, billing_interval, stripe_subscription_id').eq('user_id', userId).maybeSingle()
    const subId = data?.stripe_subscription_id as string | null | undefined
    if (!subId || !data?.plan || data.plan === 'free') return
    const sub = await stripe.subscriptions.retrieve(subId)
    const centavos = sub.items.data[0]?.price?.unit_amount ?? 0
    destino.searchParams.set('assinou', `${data.plan}-${data.billing_interval === 'year' ? 'anual' : 'mensal'}`)
    destino.searchParams.set('valor', (centavos / 100).toFixed(2))
  } catch (e) {
    console.error('[stripe-return] dados da compra para medição indisponíveis:', (e as { code?: string })?.code)
  }
}

export async function GET(request: Request) {
  const destino = new URL('/dashboard', request.url)

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await reconcileUserFromStripe(user.id)
      await anexarCompra(destino, user.id)
    }
  } catch (e) {
    // Falhar aqui não pode prender a pessoa numa tela de erro depois de pagar:
    // o webhook e a reconciliação de /planos ainda corrigem o estado. Segue
    // para o Início e registra.
    console.error('[stripe-return] reconciliação falhou:', e)
  }

  return NextResponse.redirect(destino)
}
