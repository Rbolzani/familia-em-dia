import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Gera token de convite diretamente na tabela (bypassa RLS)
  const { data: family } = await admin
    .from('families')
    .select('id')
    .eq('created_by', user.id)
    .maybeSingle()

  if (!family?.id) return NextResponse.json({ error: 'Família não encontrada' }, { status: 404 })

  const token = crypto.randomUUID()
  const { error } = await admin.from('family_invites').insert({
    family_id: family.id,
    invited_by: user.id,
    invited_email: null,
    access_role: 'full_editor',
    token,
    status: 'pending',
  })

  if (error) {
    console.error('[onboarding/invite]', error)
    return NextResponse.json({ error: 'Não foi possível gerar o convite.' }, { status: 500 })
  }

  return NextResponse.json({ token })
}
