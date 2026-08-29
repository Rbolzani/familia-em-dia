import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import DashboardClient from './DashboardClient'
import { expiryStatus, daysToExpiry } from '@/lib/vault'
import type { VacinaItem } from '@/lib/docTypes'
import { SCHOOL_KINDS_APARTE, type SchoolKind } from '@/lib/types'
import { vencimentoDe } from '@/lib/payments'

// Alertas do Cofre: documentos já vencidos ou vencendo em até 30 dias.
//
// Vacina NÃO entra aqui. Comprovante de vacinação é histórico do que foi
// aplicado — não tem data de validade nem agendamento da dose seguinte. Dose
// faltante vira lembrete no mural, sem prazo. Antes, o OCR copiava a data de
// uma dose como "próxima dose" da anterior e o painel acusava "vencido há
// 1590 dias" sobre uma dose que já havia sido tomada.
export interface ImportantAlert {
  // `documentId` virou `id` porque o painel passou a receber dois tipos de
  // alerta. `kind` decide o ícone e para onde o card leva.
  id: string
  kind: 'documento' | 'mensalidade'
  title: string
  category: string          // gaveta do cofre — só para kind='documento'
  childName: string | null
  date: string
  daysLeft: number
  status: 'vencido' | 'a_vencer'
  amount?: number | null    // só para kind='mensalidade'
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const today   = new Date()
  // Use Brazil timezone (America/Sao_Paulo) — server runs in UTC, so toISOString() would
  // give tomorrow's date for Brazilian users between 21h–24h local time.
  // 'fr-CA' locale returns yyyy-MM-dd which is what Supabase expects.
  const tz      = 'America/Sao_Paulo'
  const todayDs = new Intl.DateTimeFormat('fr-CA', { timeZone: tz }).format(today)
  const weekEnd = new Intl.DateTimeFormat('fr-CA', { timeZone: tz }).format(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)
  )
  const moStart = format(startOfMonth(today), 'yyyy-MM-dd')
  const moEnd   = format(endOfMonth(today),   'yyyy-MM-dd')

  const [
    { data: children },
    { data: todayActivities },
    { data: upcomingActivities },
    { data: monthActivities },
    { data: reminders },
    { data: expiringDocs },
    { data: activePayments },
    { data: paidMarks },
  ] = await Promise.all([
    supabase.from('children').select('*').order('sort_order'),

    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .eq('date', todayDs)
      .neq('status', 'cancelado')
      .order('time', { nullsFirst: false }),

    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .gt('date', todayDs)
      .lte('date', weekEnd)
      .neq('status', 'cancelado')
      .order('date').order('time', { nullsFirst: false }),

    // Full current month — used for mini-calendar dots + click detail
    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .gte('date', moStart).lte('date', moEnd)
      .neq('status', 'cancelado')
      .order('date').order('time', { nullsFirst: false }),

    // Reminders: activities with no date
    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .is('date', null)
      .neq('status', 'cancelado')
      .order('created_at', { ascending: false }),

    // Documentos com data de validade — alimentam os Alertas
    supabase.from('documents')
      .select('id, title, category, expires_at, child:children(name)')
      .not('expires_at', 'is', null)
      .order('expires_at'),

    // Mensalidades ativas + marcas do mês corrente — também alimentam os
    // Alertas. A ocorrência do mês é calculada, não existe como linha.
    supabase.from('payments')
      .select('id, title, amount, due_day, child:children(name)')
      .eq('active', true),
    supabase.from('payment_marks')
      .select('payment_id')
      .eq('competencia', todayDs.slice(0, 7)),
  ])

  // ── Alertas: documentos vencidos ou a vencer ──────────────────────────────
  // Reaproveita expiryStatus (mesma régua do Cofre) para não haver divergência
  // entre o que o Vault mostra como "a vencer" e o que o dashboard alerta.
  const importantAlerts: ImportantAlert[] = []

  for (const doc of expiringDocs ?? []) {
    const st = expiryStatus(doc.expires_at)
    if (st !== 'vencido' && st !== 'a_vencer') continue
    importantAlerts.push({
      id: doc.id,
      kind: 'documento',
      title: doc.title,
      category: doc.category,
      childName: (doc.child as unknown as { name: string } | null)?.name ?? null,
      date: doc.expires_at,
      daysLeft: daysToExpiry(doc.expires_at) ?? 0,
      status: st,
    })
  }

  // Mensalidades: entram SÓ a partir do vencimento — sem antecedência, porque
  // avisar antes não muda o comportamento de um PIX. Mas o vencido persiste
  // até ser pago, senão quem não abriu o app naquele dia perde o aviso.
  const competencia = todayDs.slice(0, 7)
  const jaPagos = new Set((paidMarks ?? []).map(m => m.payment_id as string))
  for (const p of activePayments ?? []) {
    if (jaPagos.has(p.id)) continue
    const venc = vencimentoDe(competencia, p.due_day)
    if (venc > todayDs) continue
    const atraso = Math.round(
      (new Date(todayDs + 'T12:00:00').getTime() - new Date(venc + 'T12:00:00').getTime()) / 86_400_000)
    importantAlerts.push({
      id: p.id,
      kind: 'mensalidade',
      title: p.title,
      category: '',
      childName: (p.child as unknown as { name: string } | null)?.name ?? null,
      date: venc,
      // Mesma convenção dos documentos: negativo = já venceu, 0 = vence hoje.
      daysLeft: -atraso,
      status: atraso > 0 ? 'vencido' : 'a_vencer',
      amount: p.amount,
    })
  }

  // Vencidos primeiro; dentro de cada grupo, o mais urgente no topo.
  importantAlerts.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'vencido' ? -1 : 1
    return a.daysLeft - b.daysLeft
  })

  const userName = user.user_metadata?.full_name?.split(' ')[0] || 'Olá'

  // "Rotina de aulas" (escola + school_kind='aula') é a grade semanal — ela
  // se repete todo dia e abafaria a agenda real. Por isso aparece só na sua
  // própria seção "Aulas de Hoje" e fica de fora das atividades, dos próximos
  // 7 dias e dos pontinhos do mini-calendário.
  const isAula = (a: { category: string; school_kind?: string | null }) =>
    a.category === 'escola' && a.school_kind === 'aula'

  // Provas seguem a mesma regra de saída (aba e seção de WhatsApp próprias),
  // então também não entram nas listas gerais do dashboard.
  const isAparte = (a: { category: string; school_kind?: string | null }) =>
    a.category === 'escola' && SCHOOL_KINDS_APARTE.includes(a.school_kind as SchoolKind)

  const todayAll     = todayActivities ?? []
  const todayClasses = todayAll.filter(isAula)
  const todayOthers  = todayAll.filter(a => !isAparte(a))

  // Provas de hoje + dos próximos 7 dias, em ordem de proximidade. Sai das
  // consultas que já foram feitas — provas estão nelas (o filtro por tipo é
  // aplicado depois, ao montar as listas gerais), então não há query extra.
  const isProva = (a: { category: string; school_kind?: string | null }) =>
    a.category === 'escola' && a.school_kind === 'prova'
  const exams = [
    ...todayAll.filter(isProva),
    ...(upcomingActivities ?? []).filter(isProva),
  ]

  return (
    <DashboardClient
      userName={userName}
      children={children ?? []}
      todayClasses={todayClasses}
      todayActivities={todayOthers}
      upcomingActivities={(upcomingActivities ?? []).filter(a => !isAparte(a))}
      monthActivities={(monthActivities ?? []).filter(a => !isAparte(a)) as Parameters<typeof DashboardClient>[0]['monthActivities']}
      exams={exams as Parameters<typeof DashboardClient>[0]['exams']}
      todayDs={todayDs}
      reminders={(reminders ?? []) as Parameters<typeof DashboardClient>[0]['reminders']}
      importantAlerts={importantAlerts}
    />
  )
}
