import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LogisticaClient from './LogisticaClient'
import { getActiveFamily } from '@/lib/access'
import { SCHOOL_KIND_GERAL_FILTER } from '@/lib/types'

export default async function LogisticaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const todayStr = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

  const { familyId } = await getActiveFamily(supabase)

  const [{ data: activities }, { data: children }, { data: rawMembers }, { data: pendingSuggestions }] = await Promise.all([
    // Nem rotina de aulas nem provas têm logística: as duas acontecem dentro
    // do dia letivo normal, sem leva/busca próprio (ver
    // SCHOOL_KIND_GERAL_FILTER em types.ts).
    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .not('date', 'is', null)
      .gte('date', todayStr)
      .neq('status', 'cancelado')
      .or(SCHOOL_KIND_GERAL_FILTER)
      .order('date').order('time', { nullsFirst: false }),
    supabase.from('children').select('*').order('sort_order'),
    familyId
      ? supabase.from('family_members').select('user_id, display_name, role').eq('family_id', familyId)
      : Promise.resolve({ data: [] }),
    familyId
      ? supabase.from('logistics_suggestions').select('*').eq('family_id', familyId).eq('status', 'pending')
      : Promise.resolve({ data: [] }),
  ])

  const members = rawMembers ?? []

  if (familyId && !members.find(m => m.role === 'owner')) {
    const { data: fam } = await supabase.from('families').select('created_by').eq('id', familyId).maybeSingle()
    if (fam?.created_by) members.push({ user_id: fam.created_by, display_name: null, role: 'owner' })
  }

  // Enriquecer display_name nulos com email via admin
  const missingIds = members.filter(m => !m.display_name).map(m => m.user_id)
  let emailMap: Record<string, string> = {}
  if (missingIds.length > 0) {
    const admin = createAdminClient()
    const { data: usersRes } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersRes?.users) {
      usersRes.users.forEach(u => { emailMap[u.id] = u.email ?? '' })
    }
  }
  const { nameFromEmail } = await import('@/lib/name-from-email')
  const familyMembers = members.map(m => ({
    ...m,
    display_name: m.display_name ?? nameFromEmail(emailMap[m.user_id] ?? ''),
  }))

  return (
    <LogisticaClient
      activities={activities ?? []}
      children={children ?? []}
      familyMembers={familyMembers}
      currentUserId={user.id}
      familyId={familyId}
      pendingSuggestions={pendingSuggestions ?? []}
    />
  )
}
