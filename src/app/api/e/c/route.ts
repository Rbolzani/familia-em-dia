// Clique no botão "Assinar o plano Família" do e-mail de fim do teste: grava o
// PRIMEIRO clique (e a abertura, se a imagem não carregou — quem clicou abriu)
// e leva para /planos com a origem do e-mail. Destino FIXO: o token só marca
// o aviso, nunca escolhe para onde ir (não vira redirecionamento aberto).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { LINK_PLANOS_EMAIL } from '@/lib/aviso-fim-teste'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get('t') ?? ''
  if (UUID.test(t)) {
    try {
      const admin = createAdminClient()
      const agora = new Date().toISOString()
      await admin.from('aviso_fim_teste').update({ email_clicado_em: agora }).eq('token', t).is('email_clicado_em', null)
      await admin.from('aviso_fim_teste').update({ email_aberto_em: agora }).eq('token', t).is('email_aberto_em', null)
    } catch (e) {
      console.error('[e/c] falha ao registrar clique:', e)
    }
  }
  return NextResponse.redirect(LINK_PLANOS_EMAIL, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}
