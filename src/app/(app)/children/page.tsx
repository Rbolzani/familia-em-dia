import { createClient } from '@/lib/supabase/server'
import ChildrenClient from './ChildrenClient'
import type { FamilyOption } from '@/components/layout/FamilySwitcher'
import { getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'
import { signChildAvatars } from '@/lib/avatars'

export default async function ChildrenPage() {
  const supabase = await createClient()
  const [{ data: children }, { data: familiesRaw }, { data: activeFamilyId }, plan] = await Promise.all([
    supabase.from('children').select('*').order('sort_order'),
    supabase.rpc('get_my_families'),
    supabase.rpc('auth_family_id'),
    getFamilyPlan(),
  ])

  const families: FamilyOption[] = (familiesRaw ?? []).map((f: {
    family_id: string; family_name: string; is_owner: boolean; is_active: boolean; member_count: number
  }) => ({
    family_id: f.family_id,
    family_name: f.family_name,
    is_owner: f.is_owner,
    is_active: f.is_active,
    member_count: Number(f.member_count),
  }))

  // Fetch active family name + ownership for rename feature
  let familyId: string | null = activeFamilyId ?? null
  let familyCurrentName: string | null = null
  let isOwner = false

  if (familyId) {
    const { data: famRow } = await supabase
      .from('families')
      .select('name, created_by')
      .eq('id', familyId)
      .maybeSingle()
    familyCurrentName = famRow?.name ?? null
    const { data: { user } } = await supabase.auth.getUser()
    isOwner = famRow?.created_by === user?.id
  }

  const childLimit = PLAN_LIMITS[plan].children

  // O banco guarda o caminho; a URL assinada nasce aqui, a cada render.
  const childrenComFoto = await signChildAvatars(supabase, children ?? [])

  return (
    <ChildrenClient
      initialChildren={childrenComFoto}
      families={families}
      familyId={familyId}
      familyCurrentName={familyCurrentName}
      isOwner={isOwner}
      plan={plan}
      childLimit={childLimit}
    />
  )
}
