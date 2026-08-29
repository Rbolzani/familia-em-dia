import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Cria o usuário já com email confirmado — SOMENTE no fluxo de convite, e a
// rota agora garante isso: exige um token de convite pendente e não expirado.
// Antes o comentário dizia "usado apenas no fluxo de convite" mas nada
// impedia qualquer um de chamar a rota direto.
// Também cria a família própria do usuário via admin, porque o bootstrap do
// layout (que normalmente cria a família) só roda quando auth_family_id é null.
// Após aceitar o convite, auth_family_id já aponta para a família do convidante,
// então o bootstrap nunca criaria a família própria sem este passo.
export async function POST(request: Request) {
  const { email, password, name, familyName, token } = await request.json()

  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ── Gate: só cria conta pré-confirmada quem tem convite vivo ─────────────
  // Sem isto a rota era um criador PÚBLICO de contas já confirmadas: sem
  // sessão, com a service role e `email_confirm: true`, dava para pular a
  // verificação de e-mail e criar usuários em massa — cada um gerando ainda
  // uma família e uma linha em family_members.
  //
  // A checagem é feita com o admin de propósito: o convidado ainda não tem
  // sessão, então não há RLS que o deixe ler o convite (e não deve haver —
  // expor family_invites publicamente foi outro achado da mesma auditoria).
  if (typeof token !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(token)) {
    return NextResponse.json({ error: 'Convite inválido ou expirado.' }, { status: 403 })
  }

  const { data: invite } = await admin
    .from('family_invites')
    .select('id')
    .eq('token', token)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!invite) {
    return NextResponse.json({ error: 'Convite inválido ou expirado.' }, { status: 403 })
  }

  const resolvedFamilyName = familyName?.trim() || 'Minha Família'

  // 1. Cria o usuário com email já confirmado
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: name,
      family_name: resolvedFamilyName,
    },
  })

  if (error) {
    const msg = error.message.includes('already registered')
      ? 'Este e-mail já está cadastrado.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const userId = data.user.id

  // 2. Cria a família própria do usuário imediatamente (via admin, bypassando RLS).
  // Isso garante que, mesmo após aceitar o convite e ter a família do dono como
  // "ativa", o usuário ainda possui a sua própria família como owner.
  const { data: fam } = await admin
    .from('families')
    .insert({ name: resolvedFamilyName, created_by: userId })
    .select('id')
    .single()

  if (fam?.id) {
    await admin.from('family_members').insert({
      family_id: fam.id,
      user_id: userId,
      role: 'owner',
    })
  }

  return NextResponse.json({ userId })
}
