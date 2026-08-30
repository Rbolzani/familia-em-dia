// Cron diário (Vercel Cron, 07:00 BRT): envia o resumo matinal
// para todos os usuários com o recurso habilitado.
import { NextRequest, NextResponse } from 'next/server'
import { adminClient, buildDailySummary, sendWhatsApp, runGraceNotices } from '@/lib/whatsapp'
import { buscarTodas } from '@/lib/paginacao'

export const maxDuration = 60

// Arredonda "HH:MM" para o slot de 15 min (cadência do cron).
function slot15(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const fm = Math.floor((m || 0) / 15) * 15
  return `${String(h).padStart(2, '0')}:${String(fm).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const now = new Date().toISOString()
  // Hora atual no fuso de Brasília (HH:MM, 24h)
  const nowSP = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const currentSlot = slot15(nowSP)
  console.log(`[whatsapp-daily] iniciando às ${now} (SP ${nowSP}, slot ${currentSlot})`)

  // Vercel Cron envia Authorization: Bearer ${CRON_SECRET} automaticamente
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET) {
    console.error('[whatsapp-daily] CRON_SECRET não configurado')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[whatsapp-daily] Authorization header inválido')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[whatsapp-daily] SUPABASE_SERVICE_ROLE_KEY não configurado')
    return NextResponse.json({ error: 'Misconfigured' }, { status: 500 })
  }

  const admin = adminClient()

  // Paginado: o PostgREST corta em 1000 linhas SEM ERRO. Esta consulta é
  // GLOBAL — todos os assinantes, não os de uma família —, então a partir de
  // mil pessoas com o resumo ligado, quem estivesse além da milésima linha
  // nunca receberia, e o log diria "concluído" igual. Comprovado no banco:
  // 1.239 atividades, um select simples devolveu 1.000.
  let allSettings: { user_id: string; whatsapp_number: string | null; summary_time: string | null }[]
  try {
    allSettings = await buscarTodas((de, ate) => admin
      .from('notification_settings')
      .select('user_id, whatsapp_number, summary_time')
      .eq('daily_summary_enabled', true)
      .not('whatsapp_number', 'is', null)
      .range(de, ate))
  } catch (settingsError) {
    console.error('[whatsapp-daily] erro ao buscar notification_settings:', settingsError)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Só envia para quem escolheu um horário que cai no slot atual (15 min)
  const settings = (allSettings ?? []).filter(s => {
    const t = (s.summary_time ?? '07:00').slice(0, 5)
    return slot15(t) === currentSlot
  })

  const total = settings.length
  console.log(`[whatsapp-daily] ${allSettings?.length ?? 0} habilitado(s), ${total} no slot ${currentSlot}`)

  let sent = 0
  let skipped = 0
  let failed = 0

  // Processa em paralelo com teto de concorrência. Sequencialmente cada
  // usuário custa ~600ms (consultas + POST na Meta), o que estoura o
  // maxDuration de 60s a partir de ~100 usuários no mesmo horário — e o
  // estouro é silencioso: a função é morta e quem estava no fim da fila
  // simplesmente não recebe. Com 8 em paralelo, 500 usuários levam ~37s.
  // O teto também protege o rate limit da Cloud API.
  const CONCURRENCY = 8

  async function processUser(s: (typeof settings)[number]) {
    try {
      const summary = await buildDailySummary(admin, s.user_id)
      if (!summary) {
        console.log(`[whatsapp-daily] user ${s.user_id}: sem atividades no período, pulando`)
        skipped++
        return
      }
      const result = await sendWhatsApp(s.whatsapp_number!, summary.params)
      if (result.ok) {
        console.log(`[whatsapp-daily] user ${s.user_id}: enviado com sucesso`)
        sent++
      } else {
        console.error(`[whatsapp-daily] user ${s.user_id}: falha no envio —`, result.error)
        failed++
      }
    } catch (e) {
      console.error(`[whatsapp-daily] user ${s.user_id}: exceção —`, e)
      failed++
    }
  }

  // Fila compartilhada: cada "worker" puxa o próximo índice ao terminar, em
  // vez de fatiar em blocos — assim um usuário lento não segura os demais.
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, settings.length) }, async () => {
      while (cursor < settings.length) {
        const s = settings[cursor++]
        await processUser(s)
      }
    })
  )

  // ── Avisos de grace (notificação de conta) — independe do toggle/horário ──
  let grace = { sent: 0, skipped: 0, failed: 0 }
  try {
    grace = await runGraceNotices(admin)
    console.log('[whatsapp-daily] grace:', grace)
  } catch (e) {
    console.error('[whatsapp-daily] erro no grace pass:', e)
  }

  const result = { sent, skipped, failed, total, grace }
  console.log('[whatsapp-daily] concluído:', result)
  return NextResponse.json(result)
}
