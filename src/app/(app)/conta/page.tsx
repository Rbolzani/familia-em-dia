import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ContaClient from './ContaClient'
import { ADDRESS_COLUMNS, addressFromRow } from '@/lib/address'

export default async function ContaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: prof } = await supabase
    .from('profiles')
    .select(`full_name, phone, cpf, marketing_consent, terms_accepted_at, ${ADDRESS_COLUMNS}`)
    .eq('user_id', user.id)
    .maybeSingle()

  // Contexto para o aviso da exclusão de conta (owner com/sem parceiros).
  const { data: familyId } = await supabase.rpc('auth_family_id')
  let isOwner = true
  let hasPartners = false
  if (familyId) {
    const { data: fam } = await supabase
      .from('families').select('created_by').eq('id', familyId).maybeSingle()
    isOwner = fam?.created_by === user.id
    const { count } = await supabase
      .from('family_members').select('id', { count: 'exact', head: true })
      .eq('family_id', familyId).eq('role', 'partner')
    hasPartners = (count ?? 0) > 0
  }

  return (
    <ContaClient
      email={user.email ?? ''}
      fullName={prof?.full_name ?? ''}
      phone={prof?.phone ?? ''}
      cpf={prof?.cpf ?? ''}
      address={addressFromRow(prof)}
      termsAccepted={!!prof?.terms_accepted_at}
      marketingConsent={prof?.marketing_consent ?? false}
      isOwner={isOwner}
      hasPartners={hasPartners}
    />
  )
}
