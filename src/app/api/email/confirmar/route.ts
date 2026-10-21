import { NextResponse } from 'next/server'
import { confirmarEmail } from '@/lib/confirmacao-email'

// Link do e-mail "Confirme seu e-mail". Funciona sem sessão (a pessoa pode
// abrir no celular, fora do app). Link usado ou substituído por um reenvio
// não vale mais: a faixa no app continua oferecendo um novo.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const ok = await confirmarEmail(url.searchParams.get('t') ?? '')
  return NextResponse.redirect(new URL(`/dashboard?email=${ok ? 'confirmado' : 'link-invalido'}`, url.origin))
}
