// Batimento dos crons — U6 (parte B) da bateria de prontidão.
//
// Detecta AUSÊNCIA, não erro. O webhook de status (/api/whatsapp/webhook)
// já avisa quando a Meta REJEITA uma entrega — isso é um erro, e todo erro
// loga. O que faltava era o outro caso: o cron parar de ser CHAMADO (segredo
// trocado, agendador externo quebrado, deploy com bug). Nada falha porque
// nada roda — e sem nada que falhe, não existe erro para o Sentry capturar.
//
// Por isso este endpoint não olha o resultado dos crons, olha a HORA da
// última vez que cada um rodou (tabela cron_heartbeats, gravada por eles
// mesmos a cada execução) e reclama se o atraso passar do razoável.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Cadência esperada de cada cron + tolerância antes de soar o alarme.
const CRONS: { name: string; maxAtrasoMin: number; descricao: string }[] = [
  // cron-job.org chama a cada 15 min — 45 min de silêncio já é 3 chamadas perdidas
  { name: 'whatsapp-daily', maxAtrasoMin: 45, descricao: 'resumo diário / avisos de grace' },
  // Vercel Cron nativo, 1x/dia às 06:00 UTC — 27h dá folga para atraso de fila
  { name: 'expire-trials', maxAtrasoMin: 27 * 60, descricao: 'expiração de trial / grace period' },
  // Vercel Cron nativo, 1x/dia às 13:00 UTC (10h de Brasília)
  { name: 'lembrete-cadastro', maxAtrasoMin: 27 * 60, descricao: 'lembrete de cadastro incompleto' },
]

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: heartbeats, error } = await admin
    .from('cron_heartbeats')
    .select('name, ran_at, result')

  if (error) {
    console.error('[check-daily-summary] erro ao ler cron_heartbeats:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const porNome = new Map((heartbeats ?? []).map(h => [h.name, h]))
  const agora = Date.now()
  const problemas: string[] = []

  for (const cron of CRONS) {
    const h = porNome.get(cron.name)
    if (!h) {
      // Nunca gravou nem uma vez — ou é recém-criado (ok, ainda não passou o
      // primeiro deploy) ou nunca rodou de verdade. Só alarma se já devia ter.
      problemas.push(`${cron.name} (${cron.descricao}): nenhum batimento registrado ainda`)
      continue
    }
    const atrasoMin = (agora - new Date(h.ran_at).getTime()) / 60_000
    if (atrasoMin > cron.maxAtrasoMin) {
      problemas.push(
        `${cron.name} (${cron.descricao}): última execução há ${Math.round(atrasoMin)} min ` +
        `(esperado no máx. ${cron.maxAtrasoMin} min) — última execução: ${h.ran_at}`
      )
    }
  }

  if (problemas.length > 0) {
    // console.error chega ao Sentry (DSN já configurado) — mesma rota do
    // alerta de entrega falhada, que já notifica por e-mail/push.
    console.error('[check-daily-summary] CRON SILENCIOSO — %s', problemas.join(' | '))
    return NextResponse.json({ ok: false, problemas }, { status: 200 })
  }

  return NextResponse.json({ ok: true })
}
