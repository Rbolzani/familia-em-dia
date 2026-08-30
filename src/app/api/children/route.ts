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

// ── Validação de entrada ────────────────────────────────────────────────────
// Achados do teste O5 (payloads malformados), todos comprovados em produção:
//   · JSON inválido, corpo vazio e array no lugar de objeto → 500 com corpo
//     VAZIO. Causa: `await request.json()` estoura sem try, e `name.trim()`
//     roda sobre `undefined`. O 500 sem corpo é o Next devolvendo uma exceção
//     não tratada.
//   · `{ name: 'A'.repeat(2_000_000) }` → 200. Um filho com nome de DOIS
//     MILHÕES de caracteres foi criado de verdade e apareceu na sidebar.
//     Não havia limite de tamanho em lugar nenhum — nem aqui, nem no banco.
const LIMITES = { name: 80, school_name: 120 } as const

/** `request.json()` que devolve erro em vez de explodir. */
async function lerJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json()
    // Array também é `object` em JS — precisa ser excluído explicitamente,
    // senão `body.name` vira undefined e o erro aparece lá na frente.
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null
    return b as Record<string, unknown>
  } catch {
    return null
  }
}

/** Texto obrigatório, com teto. Devolve o valor limpo ou uma mensagem de erro. */
function textoObrigatorio(v: unknown, campo: keyof typeof LIMITES, rotulo: string) {
  if (typeof v !== 'string') return { erro: `${rotulo} é obrigatório.` }
  const limpo = v.trim()
  if (!limpo) return { erro: `${rotulo} é obrigatório.` }
  if (limpo.length > LIMITES[campo]) {
    return { erro: `${rotulo} deve ter no máximo ${LIMITES[campo]} caracteres.` }
  }
  return { valor: limpo }
}

/** Texto opcional, com teto. */
function textoOpcional(v: unknown, campo: keyof typeof LIMITES, rotulo: string) {
  if (v === undefined || v === null || v === '') return { valor: null }
  if (typeof v !== 'string') return { erro: `${rotulo} inválido.` }
  const limpo = v.trim()
  if (!limpo) return { valor: null }
  if (limpo.length > LIMITES[campo]) {
    return { erro: `${rotulo} deve ter no máximo ${LIMITES[campo]} caracteres.` }
  }
  return { valor: limpo }
}

/** Data ISO `YYYY-MM-DD` ou nulo. */
function dataOpcional(v: unknown) {
  if (v === undefined || v === null || v === '') return { valor: null }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return { erro: 'Data de nascimento inválida.' }
  }
  return { valor: v }
}

/** Cor em hexadecimal; qualquer outra coisa cai no padrão. */
function corValida(v: unknown) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#00C48C'
}

/**
 * Campos comuns a POST e PATCH. Devolve `{ erro }` na primeira falha —
 * mensagem única é suficiente para o formulário e não vira lista de
 * diagnóstico para quem sonda a API.
 */
function validarCampos(body: Record<string, unknown>) {
  const nome = textoObrigatorio(body.name, 'name', 'Nome')
  if (nome.erro) return { erro: nome.erro }

  const escola = textoOpcional(body.school_name, 'school_name', 'Nome da escola')
  if (escola.erro) return { erro: escola.erro }

  const nasc = dataOpcional(body.birth_date)
  if (nasc.erro) return { erro: nasc.erro }

  return {
    campos: {
      name: nome.valor as string,
      school_name: escola.valor,
      birth_date: nasc.valor,
      avatar_color: corValida(body.avatar_color),
    },
  }
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

  const body = await lerJson(request)
  if (!body) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })

  const v = validarCampos(body)
  if (v.erro) return NextResponse.json({ error: v.erro }, { status: 400 })

  const sort = typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)
    ? body.sort_order : 0

  const { data, error } = await admin
    .from('children')
    .insert({ user_id: user.id, family_id: familyId, ...v.campos, sort_order: sort })
    .select()
    .single()

  // `error.message` vem do PostgREST e descreve o schema. Vai para o log, não
  // para o cliente.
  if (error) {
    console.error('[children POST]', error)
    return NextResponse.json({ error: 'Não foi possível cadastrar o filho.' }, { status: 500 })
  }
  return NextResponse.json({ child: data })
}

// PATCH — atualizar filho
export async function PATCH(request: Request) {
  const ctx = await getVerifiedContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, familyId } = ctx

  const body = await lerJson(request)
  if (!body) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })

  const id = body.id
  if (typeof id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const v = validarCampos(body)
  if (v.erro) return NextResponse.json({ error: v.erro }, { status: 400 })

  // Verificar que o filho pertence à família deste usuário
  const { data: existing } = await admin
    .from('children')
    .select('family_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing || existing.family_id !== familyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { avatar_path } = body
  const updates: Record<string, unknown> = { ...v.campos }
  // `undefined` = não mexer na foto; `null` = remover. São coisas diferentes.
  if (avatar_path !== undefined) updates.avatar_path = avatar_path

  const { data, error } = await admin
    .from('children')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[children PATCH]', error)
    return NextResponse.json({ error: 'Não foi possível salvar o filho.' }, { status: 500 })
  }
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
  if (error) {
    console.error('[children DELETE]', error)
    return NextResponse.json({ error: 'Não foi possível excluir o filho.' }, { status: 500 })
  }

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
