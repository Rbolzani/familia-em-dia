import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { destinoInternoSeguro } from '@/lib/redirectSeguro'

// Verificação de link de e-mail via token_hash (fluxo recomendado pelo Supabase
// para SSR). Diferente do /auth/callback (PKCE ?code=), o verifyOtp NÃO depende
// de cookie de code-verifier no navegador — por isso funciona quando o link do
// e-mail é aberto num navegador diferente do que pediu (comum no mobile: o link
// abre no mini-browser do Gmail). Usado hoje pela redefinição de senha.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  // A checagem caseira aceitava `/\\site.com`, que o navegador trata como
  // `//site.com` (outro domínio). `destinoInternoSeguro` recusa essa variante.
  const next = destinoInternoSeguro(searchParams.get('next'))

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_error`)
}
