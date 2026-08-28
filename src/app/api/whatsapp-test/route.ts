// Envia um resumo de teste AGORA para o número salvo do usuário logado.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient, buildDailySummary, sendWhatsApp, templateHasClasses, templateHasReminders, templateHasExams, templateHasPayments } from '@/lib/whatsapp'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: settings } = await supabase
    .from('notification_settings')
    .select('whatsapp_number')
    .eq('user_id', user.id)
    .single()

  if (!settings?.whatsapp_number) {
    return NextResponse.json({ error: 'Salve seu número de WhatsApp primeiro.' }, { status: 400 })
  }

  const admin = adminClient()
  const summary = await buildDailySummary(admin, user.id)
  // O fallback (usuário no plano free, sem resumo) precisa ter a MESMA
  // contagem de parâmetros do template ativo — e na MESMA ordem de
  // buildDailySummary. Divergir faz a Meta rejeitar a mensagem inteira.
  const params: string[] = summary?.params ?? [
    'teste de conexão OK!',
    ...(templateHasExams() ? ['Nenhuma prova nos próximos 7 dias.'] : []),
    // A mesma inversão de ordem do v5 (ver templateHasPayments em whatsapp.ts).
    ...(templateHasPayments()
      ? ['Nada a pagar hoje ✅', 'Nenhuma atividade hoje.',
         ...(templateHasClasses() ? ['Nenhuma aula hoje 🎒'] : []),
         'Nenhuma atividade nos próximos 7 dias.']
      : [...(templateHasClasses() ? ['Nenhuma aula hoje 🎒'] : []),
         'Nenhuma atividade hoje.', 'Nenhuma atividade nos próximos 7 dias.']),
    ...(templateHasReminders() ? ['Nenhum lembrete pendente. 🙌'] : []),
    'Nenhum vencimento nos próximos 15 dias.',
    'Nenhuma dose prevista nos próximos 30 dias.',
  ]

  const result = await sendWhatsApp(settings.whatsapp_number, params)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
