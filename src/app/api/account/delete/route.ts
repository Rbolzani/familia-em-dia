import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { excluirConta } from '@/lib/excluir-conta'

// Exclusão da conta pela própria pessoa (LGPD). A lógica mora em
// src/lib/excluir-conta.ts — a mesma usada na exclusão automática da conta
// pausada há 90 dias.
export async function POST(request: Request) {
  // 1. Verificar sessão
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Verificar confirmação explícita (LGPD)
  let confirmation: string
  try {
    const body = await request.json()
    confirmation = body.confirmation
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }
  if (confirmation !== 'EXCLUIR') {
    return NextResponse.json({ error: 'Confirmação inválida' }, { status: 400 })
  }

  try {
    const r = await excluirConta(createAdminClient(), user.id, user.created_at)
    if (!r.ok) {
      return NextResponse.json({
        error: 'Não consegui encerrar sua assinatura agora, e não vou apagar a conta '
          + 'deixando a cobrança ativa. Tente de novo em alguns minutos ou fale com o suporte.',
      }, { status: 503 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[delete-account]', err)
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
