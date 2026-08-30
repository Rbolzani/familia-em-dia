import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { destinoInternoSeguro } from '@/lib/redirectSeguro'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANTE: getUser() é obrigatório aqui para que o Supabase SSR
  // possa remontar e renovar os cookies de sessão fragmentados corretamente.
  // getSession() não funciona no contexto do middleware com cookies chunked.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute = pathname.startsWith('/auth')
  // Assets da landing (vídeo, imagens) ficam sob /marketing/ — não têm
  // extensão coberta pelo matcher (ex.: .mp4) e por isso passavam pelo gate
  // de auth, sendo redirecionados para /auth/login em vez de servidos.
  const isMarketingAsset = pathname.startsWith('/marketing/')
  // Termos de Uso e Privacidade precisam ser acessíveis sem login — exigidos
  // por lei (LGPD) e por revisores externos (ex.: Meta validando a marca).
  const isLegalRoute = pathname === '/termos' || pathname === '/privacidade'
  const isPublic = pathname === '/' || isMarketingAsset || isLegalRoute
  // Rotas de API fazem a própria autenticação (sessão ou CRON_SECRET).
  // Nunca redirecionar API para a página de login — isso quebrava o cron
  // do resumo diário (Vercel Cron não tem sessão → levava 307 → não rodava).
  const isApi = pathname.startsWith('/api')

  // Captura do convite no PRIMEIRO toque. Um usuário novo que clica no link
  // de convite passa por signup → confirmação de e-mail → completar-cadastro
  // antes de conseguir aceitar; o token se perdia nesses saltos e a pessoa
  // caía numa família vazia. Gravamos o token num cookie aqui (antes de
  // qualquer layout/redirect) e o consumimos ao final do cadastro.
  const inviteMatch = pathname.match(/^\/convite\/([^/]+)\/?$/)

  // Rota pública de convite — não requer autenticação prévia (usuário faz login/cadastro após ver a prévia)
  const isConviteRoute = pathname.startsWith('/convite')

  // Visitante não logado na raiz vê a landing page (rewrite, sem redirect —
  // mantém "/" na barra de endereço e responde 200, importante para
  // crawlers como o da Meta que não seguem redirect ao validar um site).
  if (!user && pathname === '/') {
    return NextResponse.rewrite(new URL('/marketing/Landing-Familia-em-Dia-P6-IA.html', request.url))
  }

  if (!user && !isAuthRoute && !isPublic && !isApi && !isConviteRoute) {
    const loginUrl = new URL('/auth/login', request.url)
    // Preserva o destino (ex.: link de convite) para retornar após o login
    if (pathname !== '/dashboard') loginUrl.searchParams.set('redirect', pathname)
    const res = NextResponse.redirect(loginUrl)
    if (inviteMatch) {
      res.cookies.set('pending_invite', inviteMatch[1], { path: '/', maxAge: 3600, sameSite: 'lax' })
    }
    return res
  }

  // Exceção: /auth/reset-password precisa ser acessível MESMO com sessão — o link
  // de recuperação de senha loga o usuário (sessão temporária) e ele precisa
  // chegar ao formulário para definir a nova senha. Sem essa exceção, o gate
  // abaixo redirecionaria para /dashboard antes de ele trocar a senha.
  if (user && isAuthRoute && pathname !== '/auth/reset-password') {
    const dest = destinoInternoSeguro(request.nextUrl.searchParams.get('redirect'))
    return NextResponse.redirect(new URL(dest, request.url))
  }

  if (inviteMatch) {
    supabaseResponse.cookies.set('pending_invite', inviteMatch[1], { path: '/', maxAge: 3600, sameSite: 'lax' })
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|txt|html|ico)$).*)'],
}
