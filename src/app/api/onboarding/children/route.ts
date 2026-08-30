import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'

interface ChildInput {
  name: string
  birth_date: string | null
  school_name: string | null
  avatar_color: string
}

export async function POST(request: Request) {
  // Verificar sessão via client normal
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `request.json()` estoura com corpo inválido, e sem try isso vira 500 de
  // corpo vazio — mesmo defeito medido em /api/children no teste O5.
  let body: { children?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const bruto = body?.children
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return NextResponse.json({ error: 'Nenhum filho informado.' }, { status: 400 })
  }
  // Teto de itens: o onboarding cria em laço, uma consulta por filho. Sem
  // limite, um corpo com milhares de entradas vira milhares de INSERTs.
  if (bruto.length > 20) {
    return NextResponse.json({ error: 'Máximo de 20 filhos por vez.' }, { status: 400 })
  }

  // Mesmos tetos de /api/children. Sem eles, um nome de 2 MB era gravado —
  // comprovado em produção no teste O5.
  const children: ChildInput[] = []
  for (const c of bruto as Record<string, unknown>[]) {
    const nome = typeof c?.name === 'string' ? c.name.trim() : ''
    if (!nome || nome.length > 80) {
      return NextResponse.json({ error: 'Nome inválido ou muito longo.' }, { status: 400 })
    }
    const escola = typeof c?.school_name === 'string' ? c.school_name.trim() : ''
    if (escola.length > 120) {
      return NextResponse.json({ error: 'Nome da escola muito longo.' }, { status: 400 })
    }
    const nasc = typeof c?.birth_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.birth_date)
      ? c.birth_date : null
    const cor = typeof c?.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.avatar_color)
      ? c.avatar_color : '#00C48C'
    children.push({ name: nome, birth_date: nasc, school_name: escola || null, avatar_color: cor })
  }

  // Admin client bypassa RLS
  const admin = createAdminClient()

  // Buscar ou criar família
  let { data: family } = await admin
    .from('families')
    .select('id')
    .eq('created_by', user.id)
    .maybeSingle()

  if (!family) {
    const familyName = (user.user_metadata?.family_name as string | undefined)?.trim() || 'Minha Família'
    const { data: newFamily, error: famErr } = await admin
      .from('families')
      .insert({ name: familyName, created_by: user.id })
      .select('id')
      .single()
    if (famErr || !newFamily) {
      console.error('[onboarding/children] familia', famErr)
      return NextResponse.json({ error: 'Não foi possível criar a família.' }, { status: 500 })
    }
    await admin.from('family_members').insert({
      family_id: newFamily.id,
      user_id: user.id,
      role: 'owner',
      access_role: 'owner',
    })
    family = newFamily
  }

  // Verificar limite de filhos do plano (existentes + os que serão inseridos).
  // Fecha o furo de paywall: o onboarding antes inseria sem checar PLAN_LIMITS.
  const plan = await getFamilyPlan()
  const childLimit = PLAN_LIMITS[plan].children
  if (childLimit !== Infinity) {
    const { count } = await admin
      .from('children')
      .select('*', { count: 'exact', head: true })
      .eq('family_id', family.id)
    if ((count ?? 0) + children.length > childLimit) {
      return NextResponse.json(
        { error: 'LIMIT_CHILDREN', plan, current: count ?? 0, adding: children.length, limit: childLimit },
        { status: 402 }
      )
    }
  }

  // Inserir filhos
  const inserted: { id: string; index: number }[] = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const { data, error } = await admin
      .from('children')
      .insert({
        user_id: user.id,
        family_id: family.id,
        name: child.name,
        birth_date: child.birth_date || null,
        school_name: child.school_name || null,
        avatar_color: child.avatar_color,
        sort_order: i,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[onboarding/children] insert', error)
      return NextResponse.json(
        { error: `Não foi possível cadastrar "${child.name}".` }, { status: 500 })
    }
    inserted.push({ id: data.id, index: i })
  }

  return NextResponse.json({ familyId: family.id, children: inserted })
}
