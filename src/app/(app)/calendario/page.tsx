import { createClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import CalendarioClient from './CalendarioClient'
import { SCHOOL_KIND_GERAL_FILTER } from '@/lib/types'

export default async function CalendarioPage() {
  const supabase  = await createClient()
  const today     = new Date()
  const start     = format(startOfMonth(today), 'yyyy-MM-dd')
  const end       = format(endOfMonth(today),   'yyyy-MM-dd')

  const [{ data: activities }, { data: children }] = await Promise.all([
    // Rotina de aulas e provas têm superfícies próprias, então ficam de fora
    // do calendário de atividades (ver SCHOOL_KIND_GERAL_FILTER em types.ts).
    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .gte('date', start).lte('date', end)
      .neq('status', 'cancelado')
      .or(SCHOOL_KIND_GERAL_FILTER)
      .order('time', { nullsFirst: false }),
    supabase.from('children').select('*').order('sort_order'),
  ])

  return (
    <CalendarioClient
      initialActivities={activities ?? []}
      initialChildren={children ?? []}
    />
  )
}
