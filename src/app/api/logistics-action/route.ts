import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/whatsapp'

// Sugestões de logística (quem leva / quem busca): avisar, aceitar, recusar.
//
// ⚠️ SEGURANÇA (item 2 da auditoria de 11/10/2026)
// Esta rota grava com a service role, que ignora a RLS — então é ELA quem tem
// de conferir tudo. Antes confiava no corpo da requisição: `activityId` e
// `field` iam direto para um UPDATE (qualquer coluna de qualquer atividade,
// de qualquer família), e `proposedTo`/`proposedBy`/`activityTitle` decidiam
// quem recebia notificação e WhatsApp, com o texto de quem chamava.
//
// Os avisos são só DENTRO DO APP (sino de notificações). O WhatsApp de
// logística foi retirado em 21/10/2026 por decisão do Rogério (custo, e nunca
// tinha chegado: usava o modelo do resumo diário, recusado pela Meta).
//
// Agora o corpo só diz QUAL sugestão (`suggestionId`) e QUAL ação. Atividade,
// campo, família, remetente, destinatário e título vêm do banco, e cada ação
// confere o papel de quem chama. Os demais campos que a tela ainda envia são
// ignorados.

const CAMPOS = ['takes_user_id', 'picks_user_id'] as const
type Campo = (typeof CAMPOS)[number]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Sugestao {
  id: string; activity_id: string; field: string
  proposed_by: string; proposed_to: string; family_id: string; status: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { action?: unknown; suggestionId?: unknown } | null
  const action = body?.action
  if (action !== 'suggest' && action !== 'accept' && action !== 'reject') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const suggestionId = typeof body?.suggestionId === 'string' && UUID.test(body.suggestionId) ? body.suggestionId : null

  const admin = adminClient()
  const negado = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── A sugestão, lida do banco ────────────────────────────────────────────
  let sug: Sugestao | null = null
  if (suggestionId) {
    const { data } = await admin.from('logistics_suggestions')
      .select('id, activity_id, field, proposed_by, proposed_to, family_id, status')
      .eq('id', suggestionId).maybeSingle()
    sug = data as Sugestao | null
  }
  // A tela, quando não consegue reler a linha que acabou de inserir, manda um
  // id provisório. Para o aviso de "suggest" vale a sugestão pendente mais
  // recente de quem chama — nunca um id que não seja dele.
  if (!sug && action === 'suggest') {
    const { data } = await admin.from('logistics_suggestions')
      .select('id, activity_id, field, proposed_by, proposed_to, family_id, status')
      .eq('proposed_by', user.id).eq('status', 'pending')
      .gte('created_at', new Date(Date.now() - 2 * 60_000).toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    sug = data as Sugestao | null
  }
  if (!sug || !CAMPOS.includes(sug.field as Campo)) return negado()

  // ── Tudo tem de pertencer à MESMA família ────────────────────────────────
  const [{ data: atividade }, { data: familia }, { data: membros }] = await Promise.all([
    admin.from('activities').select('id, title, date, family_id').eq('id', sug.activity_id).maybeSingle(),
    admin.from('families').select('created_by').eq('id', sug.family_id).maybeSingle(),
    admin.from('family_members').select('user_id, role, access_role, display_name')
      .eq('family_id', sug.family_id).in('user_id', [sug.proposed_by, sug.proposed_to]),
  ])
  if (!atividade || !familia || atividade.family_id !== sug.family_id) return negado()

  const membro = (id: string) => (membros ?? []).find(m => m.user_id === id)
  const naFamilia = (id: string) => familia.created_by === id || !!membro(id)
  // Marcar leva/busca: dono, acesso completo ou logística. "Apenas leitura" não.
  const podeLogistica = (id: string) => {
    if (familia.created_by === id) return true
    const m = membro(id)
    return !!m && (m.role === 'owner' || m.access_role === 'full_editor' || m.access_role === 'logistics_editor')
  }
  if (!naFamilia(sug.proposed_by) || !naFamilia(sug.proposed_to)) return negado()

  async function nomeDe(id: string): Promise<string> {
    const m = membro(id)
    if (m?.display_name) return m.display_name
    const { data } = await admin.auth.admin.getUserById(id)
    return data.user?.email ?? 'Parceiro(a)'
  }
  async function notificar(id: string, type: string, payload: Record<string, unknown>) {
    await admin.rpc('create_logistics_notification', { p_user_id: id, p_family_id: sug!.family_id, p_type: type, p_payload: payload })
  }
  const titulo = (atividade.title as string) || 'Atividade'

  // ── suggest: quem propôs avisa o destinatário ────────────────────────────
  if (action === 'suggest') {
    if (sug.proposed_by !== user.id || sug.status !== 'pending') return negado()
    const proposerName = await nomeDe(user.id)
    await notificar(sug.proposed_to, 'logistics_suggestion', {
      suggestion_id: sug.id, proposed_by: user.id, proposed_by_name: proposerName, activity_title: titulo,
    })
    return NextResponse.json({ ok: true })
  }

  // ── accept / reject: só o destinatário, e só enquanto está pendente ──────
  if (sug.proposed_to !== user.id || sug.status !== 'pending') return negado()

  if (action === 'accept') {
    if (!podeLogistica(user.id)) return negado()
    const campo = sug.field as Campo
    const { error } = await admin.from('activities').update({ [campo]: user.id }).eq('id', atividade.id).eq('family_id', sug.family_id)
    if (error) {
      console.error('[logistics-action] accept:', error.message)
      return NextResponse.json({ error: 'Não foi possível confirmar.' }, { status: 500 })
    }
    await admin.from('logistics_suggestions').update({ status: 'accepted' }).eq('id', sug.id)
    await notificar(sug.proposed_by, 'logistics_accepted', {
      accepted_by: user.id, accepted_by_name: await nomeDe(user.id), activity_title: titulo,
    })
    return NextResponse.json({ ok: true })
  }

  // reject
  await admin.from('logistics_suggestions').update({ status: 'rejected' }).eq('id', sug.id)
  const rejecterName = await nomeDe(user.id)
  const activityDate = (atividade.date as string | null) ?? null
  await notificar(sug.proposed_by, 'logistics_rejected', {
    rejected_by: user.id, rejected_by_name: rejecterName, activity_title: titulo, activity_date: activityDate,
  })
  return NextResponse.json({ ok: true })
}
