import { createClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import CalendarioClient from './CalendarioClient'

export default async function CalendarioPage() {
  const supabase  = await createClient()
  const today     = new Date()
  const start     = format(startOfMonth(today), 'yyyy-MM-dd')
  const end       = format(endOfMonth(today),   'yyyy-MM-dd')

  const [{ data: activities }, { data: children }] = await Promise.all([
    // A rotina de aulas tem sua própria visão (grade semanal), então fica de
    // fora do calendário de atividades. `or` com is.null é obrigatório:
    // `neq('school_kind','aula')` sozinho descartaria as atividades normais,
    // que têm school_kind NULL.
    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .gte('date', start).lte('date', end)
      .neq('status', 'cancelado')
      .or('school_kind.is.null,school_kind.neq.aula')
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
