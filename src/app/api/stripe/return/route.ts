import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'

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
export async function GET(request: Request) {
  const destino = new URL('/dashboard', request.url)

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await reconcileUserFromStripe(user.id)
  } catch (e) {
    // Falhar aqui não pode prender a pessoa numa tela de erro depois de pagar:
    // o webhook e a reconciliação de /planos ainda corrigem o estado. Segue
    // para o Início e registra.
    console.error('[stripe-return] reconciliação falhou:', e)
  }

  return NextResponse.redirect(destino)
}
