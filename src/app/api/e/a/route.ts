// Abertura do e-mail de fim do teste: a imagem invisível do e-mail aponta para
// cá com o token do aviso. Grava a PRIMEIRA abertura e devolve um GIF de 1×1.
// Pública de propósito (quem abre não está logado no programa de e-mail); o
// token é aleatório e só serve para marcar a abertura daquele aviso.
// ⚠️ Abertura é tendência, não número exato: o Mail do iPhone carrega imagens
// sozinho e outros programas as bloqueiam.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// GIF transparente de 1×1
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get('t') ?? ''
  if (UUID.test(t)) {
    try {
      await createAdminClient().from('aviso_fim_teste')
        .update({ email_aberto_em: new Date().toISOString() })
        .eq('token', t).is('email_aberto_em', null)
    } catch (e) {
      console.error('[e/a] falha ao registrar abertura:', e)
    }
  }
  return new NextResponse(PIXEL, {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0', 'Content-Length': String(PIXEL.length) },
  })
}
