import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let invitedEmail: string | null = null
  let accessRole: string = 'logistics_editor'
  let familyId: string | null = null

  try {
    const body = await request.json()
    invitedEmail = body.invited_email ?? null
    accessRole   = body.access_role ?? 'logistics_editor'
    familyId     = body.family_id ?? null
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }

  // Verifica se o usuário é owner desta família
  if (familyId) {
    const { data: fam } = await supabase
      .from('families')
      .select('created_by')
      .eq('id', familyId)
      .maybeSingle()
    if (fam?.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Verifica limite de parceiros do plano
  const plan = await getFamilyPlan()
  const partnerLimit = PLAN_LIMITS[plan].partners

  if (partnerLimit === 0) {
    return NextResponse.json({
      error: 'LIMIT_PARTNERS',
      plan,
      limit: 0,
      message: 'Compartilhamento não está disponível no plano gratuito.',
    }, { status: 402 })
  }

  if (partnerLimit !== Infinity) {
    // Conta parceiros ativos nesta família
    const { count } = await supabase
      .from('family_members')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId ?? '')
      .eq('role', 'partner')

    if ((count ?? 0) >= partnerLimit) {
      return NextResponse.json({
        error: 'LIMIT_PARTNERS',
        plan,
        current: count,
        limit: partnerLimit,
        message: `Seu plano ${plan} permite apenas ${partnerLimit} parceiro(s).`,
      }, { status: 402 })
    }
  }

  const admin = createAdminClient()

  // Expira convites anteriores para o mesmo email (se email fornecido)
  if (invitedEmail && familyId) {
    await admin.from('family_invites')
      .update({ status: 'expired' })
      .eq('family_id', familyId)
      .eq('status', 'pending')
      .eq('invited_email', invitedEmail)
  }

  const token = crypto.randomUUID()
  const { data, error } = await admin.from('family_invites')
    .insert({
      family_id:     familyId,
      invited_by:    user.id,
      invited_email: invitedEmail,
      access_role:   accessRole,
      token,
      status:        'pending',
    })
    .select('id, token, invited_email, access_role, expires_at')
    .single()

  if (error || !data) {
    console.error('[invites/create]', error?.message)
    return NextResponse.json({ error: 'Não foi possível criar o convite.' }, { status: 500 })
  }

  return NextResponse.json(data)
}
