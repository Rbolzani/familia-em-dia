import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import DashboardClient from './DashboardClient'
import { expiryStatus, daysToExpiry } from '@/lib/vault'
import type { VacinaItem } from '@/lib/docTypes'

export interface VaccineAlert {
  documentId: string
  childName: string | null
  vaccineName: string
  proxima_dose: string
  daysLeft: number
  status: 'vencido' | 'a_vencer'
}

// Alerta unificado do Cofre: vencimento de documento OU próxima dose de
// vacina. Só entram itens já vencidos ou vencendo em até 30 dias — o painel
// perde o sentido se virar a lista completa de documentos.
export interface ImportantAlert {
  documentId: string
  kind: 'documento' | 'vacina'
  title: string
  category: string          // gaveta do cofre, para cor e rótulo
  childName: string | null
  date: string
  daysLeft: number
  status: 'vencido' | 'a_vencer'
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
    { data: vaccineDocs },
    { data: expiringDocs },
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

    // Vaccine documents — for upcoming dose alerts
    supabase.from('documents')
      .select('id, title, metadata, child:children(name)')
      .eq('doc_type', 'vacinacao'),

    // Documentos com data de validade — alimentam os Alertas Importantes
    supabase.from('documents')
      .select('id, title, category, expires_at, child:children(name)')
      .not('expires_at', 'is', null)
      .order('expires_at'),
  ])

  // Compute upcoming vaccine dose alerts (vencido + a_vencer nos próximos 30 dias)
  const vaccineAlerts: VaccineAlert[] = []
  for (const doc of vaccineDocs ?? []) {
    const vacinas = ((doc.metadata as Record<string, unknown>)?.vacinas ?? []) as VacinaItem[]
    for (const v of vacinas) {
      if (!v.proxima_dose || !v.nome) continue
      const st = expiryStatus(v.proxima_dose)
      if (st !== 'vencido' && st !== 'a_vencer') continue
      vaccineAlerts.push({
        documentId: doc.id,
        childName: (doc.child as unknown as { name: string } | null)?.name ?? null,
        vaccineName: v.nome,
        proxima_dose: v.proxima_dose,
        daysLeft: daysToExpiry(v.proxima_dose) ?? 0,
        status: st,
      })
    }
  }
  vaccineAlerts.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'vencido' ? -1 : 1
    return a.daysLeft - b.daysLeft
  })

  // ── Alertas Importantes: documentos vencendo + doses de vacina ────────────
  // Reaproveita expiryStatus (mesma régua do Cofre) para não haver divergência
  // entre o que o Vault mostra como "a vencer" e o que o dashboard alerta.
  const importantAlerts: ImportantAlert[] = []

  for (const doc of expiringDocs ?? []) {
    const st = expiryStatus(doc.expires_at)
    if (st !== 'vencido' && st !== 'a_vencer') continue
    importantAlerts.push({
      documentId: doc.id,
      kind: 'documento',
      title: doc.title,
      category: doc.category,
      childName: (doc.child as unknown as { name: string } | null)?.name ?? null,
      date: doc.expires_at,
      daysLeft: daysToExpiry(doc.expires_at) ?? 0,
      status: st,
    })
  }

  for (const v of vaccineAlerts) {
    importantAlerts.push({
      documentId: v.documentId,
      kind: 'vacina',
      title: v.vaccineName,
      category: 'vacinacao',
      childName: v.childName,
      date: v.proxima_dose,
      daysLeft: v.daysLeft,
      status: v.status,
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

  const todayAll     = todayActivities ?? []
  const todayClasses = todayAll.filter(isAula)
  const todayOthers  = todayAll.filter(a => !isAula(a))

  return (
    <DashboardClient
      userName={userName}
      children={children ?? []}
      todayClasses={todayClasses}
      todayActivities={todayOthers}
      upcomingActivities={(upcomingActivities ?? []).filter(a => !isAula(a))}
      monthActivities={(monthActivities ?? []).filter(a => !isAula(a)) as Parameters<typeof DashboardClient>[0]['monthActivities']}
      reminders={(reminders ?? []) as Parameters<typeof DashboardClient>[0]['reminders']}
      vaccineAlerts={vaccineAlerts}
      importantAlerts={importantAlerts}
    />
  )
}
