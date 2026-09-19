import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient, sendWhatsApp } from '@/lib/whatsapp'

// POST /api/logistics-action
// body: { action: 'suggest' | 'accept' | 'reject', ...params }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body
  const admin = adminClient()

  // Helper: get user's whatsapp phone from notification_settings
  async function getUserPhone(userId: string): Promise<string | null> {
    const { data } = await admin.from('notification_settings').select('whatsapp_number').eq('user_id', userId).maybeSingle()
    return data?.whatsapp_number ?? null
  }

  // Helper: get user's display name
  async function getUserName(userId: string, familyId: string): Promise<string> {
    const { data } = await admin.from('family_members')
      .select('display_name').eq('user_id', userId).eq('family_id', familyId).maybeSingle()
    if (data?.display_name) return data.display_name
    const { data: authUser } = await admin.auth.admin.getUserById(userId)
    return authUser.user?.email ?? 'Parceiro(a)'
  }

  // Helper: create in-app notification via DEFINER function (bypasses RLS for target user)
  async function createNotification(userId: string, familyId: string, type: string, payload: Record<string, unknown>) {
    await admin.rpc('create_logistics_notification', {
      p_user_id: userId,
      p_family_id: familyId,
      p_type: type,
      p_payload: payload,
    })
  }

  // ── ACTION: suggest ────────────────────────────────────────────────────
  if (action === 'suggest') {
    const { suggestionId, proposedTo, familyId, activityTitle } = body

    const proposerName = await getUserName(user.id, familyId)

    // In-app notification for proposedTo
    await createNotification(proposedTo, familyId, 'logistics_suggestion', {
      suggestion_id: suggestionId,
      proposed_by: user.id,
      proposed_by_name: proposerName,
      activity_title: activityTitle,
    })

    // WhatsApp para o proposedTo — só envia se não há outras sugestões pendentes já existentes
    // (evita 1 disparo por sugestão; o usuário recebe apenas 1 aviso de "tem pendências")
    const { count: otherPending } = await admin
      .from('logistics_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('proposed_to', proposedTo)
      .eq('family_id', familyId)
      .eq('status', 'pending')
      .neq('id', suggestionId)
    if ((otherPending ?? 0) === 0) {
      const phone = await getUserPhone(proposedTo)
      if (phone) {
        const msg = `Você tem sugestões de logística de ${proposerName} pendentes. Acesse o app Família em Dia para aceitar ou recusar.`
        await sendWhatsApp(phone, msg, undefined, { userId: proposedTo, kind: 'logistica' })
      }
    }

    return NextResponse.json({ ok: true })
  }

  // ── ACTION: accept ─────────────────────────────────────────────────────
  if (action === 'accept') {
    const { suggestionId, activityId, field, proposedBy, familyId, activityTitle } = body

    // Update activity field
    await admin.from('activities').update({ [field]: user.id }).eq('id', activityId)

    // Mark suggestion accepted
    await admin.from('logistics_suggestions').update({ status: 'accepted' }).eq('id', suggestionId)

    const accepterName = await getUserName(user.id, familyId)

    // In-app notification for proposedBy
    await createNotification(proposedBy, familyId, 'logistics_accepted', {
      accepted_by: user.id,
      accepted_by_name: accepterName,
      activity_title: activityTitle,
    })

    return NextResponse.json({ ok: true })
  }

  // ── ACTION: reject ─────────────────────────────────────────────────────
  if (action === 'reject') {
    const { suggestionId, proposedBy, familyId, activityTitle, activityDate } = body

    // Mark suggestion rejected
    await admin.from('logistics_suggestions').update({ status: 'rejected' }).eq('id', suggestionId)

    const rejecterName = await getUserName(user.id, familyId)

    // In-app notification for proposedBy
    await createNotification(proposedBy, familyId, 'logistics_rejected', {
      rejected_by: user.id,
      rejected_by_name: rejecterName,
      activity_title: activityTitle,
      activity_date: activityDate,
    })

    // WhatsApp para o proposedBy
    const phone = await getUserPhone(proposedBy)
    if (phone) {
      const fmtDate = activityDate
        ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(activityDate + 'T12:00:00'))
        : ''
      const msg = `${rejecterName} recusou sua sugestão de logística para a atividade ${activityTitle}${fmtDate ? ` na data ${fmtDate}` : ''}. O slot está livre novamente.`
      await sendWhatsApp(phone, msg, undefined, { userId: proposedBy, kind: 'logistica' })
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
