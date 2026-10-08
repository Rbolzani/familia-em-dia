// Cron diário (Vercel Cron, 10:00 BRT): lembra, UMA vez, quem criou a conta
// e ainda não começou a usar.
//
// Quem entra: conta criada há mais de 24h, e-mail confirmado, NENHUM filho
// cadastrado, teste grátis ainda correndo (o texto diz "seu teste já está
// valendo" — depois dos 14 dias seria mentira) e sem lembrete anterior.
// Quem fica de fora: convidado por link (usa os filhos de outra família) e
// conta cortesia (não está em teste).
// O nome da rota e da tabela (`cadastro_lembretes`) vem da primeira versão,
// que mirava o cadastro incompleto — etapa que deixou de existir.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmail } from '@/lib/email'
import { LEGAL_ENTITY } from '@/lib/legal'
import { ASSUNTO_LEMBRETE, REMETENTE_LEMBRETE, lembreteEmHtml, lembreteEmTexto } from '@/lib/lembrete-cadastro'

export const maxDuration = 60

const ESPERA_MS = 24 * 3_600_000
// Teto por execução: um defeito na seleção não vira disparo em massa.
const MAX_POR_EXECUCAO = 100

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const agora = Date.now()

  // Contas criadas há mais de 24h, com e-mail confirmado.
  const antigas = new Map<string, string>()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error('[lembrete-cadastro] erro ao listar usuários:', error.message)
      return NextResponse.json({ error: 'auth.users' }, { status: 500 })
    }
    for (const u of data.users) {
      if (u.email && u.email_confirmed_at && agora - new Date(u.created_at).getTime() >= ESPERA_MS) {
        antigas.set(u.id, u.email)
      }
    }
    if (data.users.length < 1000) break
  }

  // Em teste grátis agora. Paginado: o PostgREST corta em 1000 linhas sem avisar.
  const candidatos: string[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin
      .from('subscriptions').select('user_id').eq('status', 'trialing')
      .gt('trial_ends_at', new Date(agora).toISOString()).order('user_id').range(de, de + 999)
    if (error) {
      console.error('[lembrete-cadastro] erro ao ler assinaturas:', error.code)
      return NextResponse.json({ error: error.code }, { status: 500 })
    }
    for (const r of data ?? []) if (antigas.has(r.user_id as string)) candidatos.push(r.user_id as string)
    if (!data || data.length < 1000) break
  }

  // Tira quem já cadastrou filho, quem é convidado em outra família e quem já
  // foi lembrado (em lotes, para o filtro caber no endereço da consulta).
  const fora = new Set<string>()
  for (let i = 0; i < candidatos.length; i += 200) {
    const lote = candidatos.slice(i, i + 200)
    const [comFilho, convidados, lembrados] = await Promise.all([
      admin.from('children').select('user_id').in('user_id', lote),
      admin.from('family_members').select('user_id').neq('role', 'owner').in('user_id', lote),
      admin.from('cadastro_lembretes').select('user_id').in('user_id', lote),
    ])
    const falha = comFilho.error ?? convidados.error ?? lembrados.error
    if (falha) {
      console.error('[lembrete-cadastro] erro ao selecionar:', falha.code)
      return NextResponse.json({ error: falha.code }, { status: 500 })
    }
    for (const r of [...(comFilho.data ?? []), ...(convidados.data ?? []), ...(lembrados.data ?? [])]) fora.add(r.user_id as string)
  }
  const pendentes = candidatos.filter(id => !fora.has(id)).slice(0, MAX_POR_EXECUCAO)

  let enviados = 0, falhas = 0
  const semChave = !process.env.RESEND_API_KEY
  if (semChave) {
    // Nada é marcado: quando a chave existir, estes mesmos recebem.
    if (pendentes.length > 0) console.error('[lembrete-cadastro] RESEND_API_KEY ausente — %d lembrete(s) aguardando', pendentes.length)
  } else {
    for (const userId of pendentes) {
      // Marca ANTES de enviar: a chave primária barra um segundo envio se duas
      // execuções se cruzarem. Se o envio falhar, a marca sai e amanhã tenta de novo.
      const { error: marcaErr } = await admin.from('cadastro_lembretes').insert({ user_id: userId })
      if (marcaErr) continue

      const r = await enviarEmail(
        antigas.get(userId) as string, ASSUNTO_LEMBRETE, lembreteEmHtml(), lembreteEmTexto(),
        { de: REMETENTE_LEMBRETE, responderPara: LEGAL_ENTITY.email },
      )
      if (r.ok) { enviados++; continue }
      falhas++
      await admin.from('cadastro_lembretes').delete().eq('user_id', userId)
      console.error('[lembrete-cadastro] envio falhou:', r.naoConfigurado ? 'sem chave' : r.erro)
    }
  }

  const result = { pendentes: pendentes.length, enviados, falhas, semChave }

  // Batimento — mesma lógica dos outros crons (ver check-daily-summary).
  try {
    await admin.from('cron_heartbeats').upsert(
      { name: 'lembrete-cadastro', ran_at: new Date().toISOString(), result },
      { onConflict: 'name' },
    )
  } catch (e) {
    console.error('[lembrete-cadastro] falha ao gravar heartbeat:', e)
  }

  return NextResponse.json(result)
}
