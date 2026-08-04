import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ActivitiesPage from '@/components/activities/ActivitiesPage'
import { nameFromEmail } from '@/lib/name-from-email'
import { getActiveFamily } from '@/lib/access'

export default async function EscolaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { familyId, isOwner } = await getActiveFamily(supabase)

  const [{ data: activities }, { data: children }, { data: rawMembers }, { data: suggestions }] = await Promise.all([
    supabase.from('activities').select('*, child:children(name, avatar_color)').eq('category', 'escola').order('date').order('time', { nullsFirst: false }),
    supabase.from('children').select('*').order('sort_order'),
    familyId ? supabase.from('family_members').select('user_id, display_name, role').eq('family_id', familyId) : Promise.resolve({ data: [] }),
    familyId ? supabase.from('logistics_suggestions').select('*').eq('family_id', familyId).eq('status', 'pending') : Promise.resolve({ data: [] }),
  ])

  const members = rawMembers ?? []

  // Ensure the family owner is always in the list so partners can suggest them
  if (familyId && !members.find(m => m.role === 'owner')) {
    const { data: fam } = await supabase.from('families').select('created_by').eq('id', familyId).maybeSingle()
    if (fam?.created_by) members.push({ user_id: fam.created_by, display_name: null, role: 'owner' })
  }

  const missingIds = members.filter(m => !m.display_name).map(m => m.user_id)
  let emailMap: Record<string, string> = {}
  if (missingIds.length > 0) {
    const admin = createAdminClient()
    const { data: usersRes } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersRes?.users) usersRes.users.forEach(u => { emailMap[u.id] = u.email ?? '' })
  }
  const familyMembers = members.map(m => ({ ...m, display_name: m.display_name ?? nameFromEmail(emailMap[m.user_id] ?? '') }))

  return (
    <ActivitiesPage
      category="escola" title="Escola" emoji="📘" color="#2563eb"
      initialActivities={activities ?? []} initialChildren={children ?? []}
      familyMembers={familyMembers} currentUserId={user.id}
      familyId={familyId} isOwner={isOwner} initialSuggestions={suggestions ?? []}
    />
  )
}
