import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'

async function getVerifiedContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()

  // Garantir que família existe (bootstrap para usuários sem família)
  let { data: family } = await admin
    .from('families')
    .select('id')
    .eq('created_by', user.id)
    .maybeSingle()

  if (!family) {
    const familyName = (user.user_metadata?.family_name as string | undefined)?.trim() || 'Minha Família'
    const { data: newFamily } = await admin
      .from('families')
      .insert({ name: familyName, created_by: user.id })
      .select('id')
      .single()
    if (newFamily) {
      await admin.from('family_members').insert({
        family_id: newFamily.id,
        user_id: user.id,
        role: 'owner',
        access_role: 'owner',
      })
      family = newFamily
    }
  }

  if (!family) return null
  return { user, admin, familyId: family.id }
}

// POST — criar filho
export async function POST(request: Request) {
  const ctx = await getVerifiedContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, familyId } = ctx

  // Verificar limite de filhos do plano
  const plan = await getFamilyPlan()
  const childLimit = PLAN_LIMITS[plan].children
  if (childLimit !== Infinity) {
    const { count } = await admin
      .from('children')
      .select('*', { count: 'exact', head: true })
      .eq('family_id', familyId)
    if ((count ?? 0) >= childLimit) {
      return NextResponse.json(
        { error: 'LIMIT_CHILDREN', plan, current: count, limit: childLimit },
        { status: 402 }
      )
    }
  }

  const body = await request.json()
  const { name, birth_date, school_name, avatar_color, sort_order } = body

  const { data, error } = await admin
    .from('children')
    .insert({
      user_id: user.id,
      family_id: familyId,
      name: name.trim(),
      birth_date: birth_date || null,
      school_name: school_name?.trim() || null,
      avatar_color: avatar_color || '#00C48C',
      sort_order: sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ child: data })
}

// PATCH — atualizar filho
export async function PATCH(request: Request) {
  const ctx = await getVerifiedContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, familyId } = ctx

  const body = await request.json()
  const { id, name, birth_date, school_name, avatar_color, avatar_path } = body

  // Verificar que o filho pertence à família deste usuário
  const { data: existing } = await admin
    .from('children')
    .select('family_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing || existing.family_id !== familyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    name: name.trim(),
    birth_date: birth_date || null,
    school_name: school_name?.trim() || null,
    avatar_color,
  }
  // `undefined` = não mexer na foto; `null` = remover. São coisas diferentes.
  if (avatar_path !== undefined) updates.avatar_path = avatar_path

  const { data, error } = await admin
    .from('children')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ child: data })
}

// DELETE — remover filho
export async function DELETE(request: Request) {
  const ctx = await getVerifiedContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, familyId } = ctx

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: existing } = await admin
    .from('children')
    .select('family_id, avatar_path')
    .eq('id', id)
    .maybeSingle()

  if (!existing || existing.family_id !== familyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin.from('children').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Apagar a linha sem apagar o arquivo deixava a foto da criança no bucket
  // sem nada apontando para ela — órfã e invisível. Melhor esforço: a linha
  // já saiu, não faz sentido devolver erro por causa do arquivo.
  if (existing.avatar_path) {
    const { error: stErr } = await admin.storage
      .from('avatars')
      .remove([existing.avatar_path as string])
    if (stErr) console.error('[children DELETE] avatar:', stErr)
  }

  return NextResponse.json({ ok: true })
}
