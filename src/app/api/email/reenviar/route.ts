import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { enviarConfirmacaoEmail } from '@/lib/confirmacao-email'

// Botão "Reenviar" da faixa "Confirme seu e-mail". Um envio a cada 2 minutos.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('full_name, email_confirmado_em').eq('user_id', user.id).maybeSingle()
  if (p?.email_confirmado_em) return NextResponse.json({ ok: true, jaConfirmado: true })

  const doisMin = new Date(Date.now() - 120_000).toISOString()
  const { count } = await admin.from('email_confirmacoes').select('token', { count: 'exact', head: true }).eq('user_id', user.id).gte('criado_em', doisMin)
  if ((count ?? 0) > 0) return NextResponse.json({ error: 'Acabamos de enviar. Aguarde um pouco antes de pedir de novo.' }, { status: 429 })

  const ok = await enviarConfirmacaoEmail(user.id, user.email, (p?.full_name as string | null) ?? null)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Não conseguimos enviar agora. Tente de novo em instantes.' }, { status: 502 })
}
