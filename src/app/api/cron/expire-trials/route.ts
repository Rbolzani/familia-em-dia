import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const GRACE_DAYS = 5

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // ── FASE 1: Trial expirado → free + iniciar grace period ─────────────────
  const { data: expiredTrials, error: trialErr } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'trialing')
    .lt('trial_ends_at', now)

  if (trialErr) {
    console.error('[expire-trials] erro na fase 1:', trialErr)
    return NextResponse.json({ error: trialErr.message }, { status: 500 })
  }

  let phase1Count = 0
  if (expiredTrials && expiredTrials.length > 0) {
    const graceUntil = new Date(Date.now() + GRACE_DAYS * 86_400_000).toISOString()

    // Para cada owner com trial expirado, verifica se tem parceiros ativos
    for (const { user_id } of expiredTrials) {
      const { data: fam } = await admin
        .from('families')
        .select('id')
        .eq('created_by', user_id)
        .maybeSingle()

      let partnerGraceUntil: string | null = null
      if (fam?.id) {
        const { count } = await admin
          .from('family_members')
          .select('id', { count: 'exact', head: true })
          .eq('family_id', fam.id)
          .eq('role', 'partner')
        if ((count ?? 0) > 0) {
          partnerGraceUntil = graceUntil
        }
      }

      await admin
        .from('subscriptions')
        .update({
          plan: 'free',
          status: 'free',
          trial_ends_at: null,
          partner_grace_until: partnerGraceUntil,
          updated_at: now,
        })
        .eq('user_id', user_id)

      phase1Count++
    }

    console.log(`[expire-trials] fase 1: ${phase1Count} trial(s) expirado(s) → free`)
  }

  // ── FASE 2: Grace period encerrado → remover parceiros ───────────────────
  const { data: graceExpired, error: graceErr } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('plan', 'free')
    .not('partner_grace_until', 'is', null)
    .lt('partner_grace_until', now)

  if (graceErr) {
    console.error('[expire-trials] erro na fase 2:', graceErr)
    return NextResponse.json({ error: graceErr.message, phase1: phase1Count }, { status: 500 })
  }

  let phase2Count = 0
  if (graceExpired && graceExpired.length > 0) {
    for (const { user_id } of graceExpired) {
      const { data: fam } = await admin
        .from('families')
        .select('id')
        .eq('created_by', user_id)
        .maybeSingle()

      if (fam?.id) {
        // Remove todos os parceiros desta família
        const { data: partners } = await admin
          .from('family_members')
          .select('user_id')
          .eq('family_id', fam.id)
          .eq('role', 'partner')

        if (partners && partners.length > 0) {
          await admin
            .from('family_members')
            .delete()
            .eq('family_id', fam.id)
            .eq('role', 'partner')

          console.log(`[expire-trials] fase 2: família ${fam.id} — ${partners.length} parceiro(s) removido(s)`)
          phase2Count += partners.length
        }
      }

      // Limpa o campo após remoção
      await admin
        .from('subscriptions')
        .update({ partner_grace_until: null, updated_at: now })
        .eq('user_id', user_id)
    }

    console.log(`[expire-trials] fase 2: ${phase2Count} parceiro(s) desconectado(s)`)
  }

  const result = { phase1: phase1Count, phase2Partners: phase2Count }

  // Batimento — mesma lógica do whatsapp-daily (ver check-daily-summary).
  try {
    await admin.from('cron_heartbeats').upsert(
      { name: 'expire-trials', ran_at: new Date().toISOString(), result },
      { onConflict: 'name' },
    )
  } catch (e) {
    console.error('[expire-trials] falha ao gravar heartbeat:', e)
  }

  return NextResponse.json(result)
}
