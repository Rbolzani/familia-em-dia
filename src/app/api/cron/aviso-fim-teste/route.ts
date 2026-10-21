// Aviso de fim do teste grátis (Vercel Cron, 1×/dia às 11h de Brasília).
//
// Dois avisos para quem está no teste do Família e ainda não assinou:
//   d3 — faltando 3 dias (ou 2, se a execução de um dia falhou);
//   d1 — na véspera (ou no último dia).
// Cada um sai UMA vez por pessoa: WhatsApp (modelo de Marketing `fim_teste`,
// com o botão de assinatura; reserva `aviso_conta`) e e-mail. Envio em
// src/lib/aviso-fim-teste-envio.ts; textos em src/lib/aviso-fim-teste.ts.
// Às 11h e não junto do resumo diário (7h): uma mensagem não apaga a outra.
// Decisão do Rogério (16/10/2026): durante o dia, depois de levar as crianças
// e antes do almoço; às 20h a mãe está ocupada com casa e filhos.
//
// Quem fica de fora: quem já assinou no teste (tem assinatura no Stripe),
// convidados por link (usam o plano de outra família) e contas cortesia (não
// estão em teste). Controle em `aviso_fim_teste` (uma linha por pessoa e etapa).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { diasAteFim } from '@/lib/aviso-fim-teste'
import { enviarAvisoFimTeste } from '@/lib/aviso-fim-teste-envio'
import { avisarAntesDaCobranca, diasAte } from '@/lib/avisos-conta'

export const maxDuration = 60

const DIA = 86_400_000
const MAX_POR_EXECUCAO = 100

function etapaDe(dias: number): 'd3' | 'd1' | null {
  if (dias === 3 || dias === 2) return 'd3'
  if (dias === 1 || dias === 0) return 'd1'
  return null
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const agora = new Date()

  const { data: emTeste, error } = await admin
    .from('subscriptions')
    .select('user_id, trial_ends_at')
    .eq('status', 'trialing')
    .eq('oferta', 'v1')
    .is('stripe_subscription_id', null)
    .gt('trial_ends_at', agora.toISOString())
    .lte('trial_ends_at', new Date(agora.getTime() + 4 * DIA).toISOString())
    .limit(1000)
  if (error) {
    console.error('[aviso-fim-teste] erro ao ler assinaturas:', error.code)
    return NextResponse.json({ error: error.code }, { status: 500 })
  }

  const candidatos = (emTeste ?? [])
    .map(r => ({ userId: r.user_id as string, fim: new Date(r.trial_ends_at as string) }))
    .map(c => ({ ...c, etapa: etapaDe(diasAteFim(c.fim, agora)) }))
    .filter((c): c is { userId: string; fim: Date; etapa: 'd3' | 'd1' } => c.etapa !== null)

  const ids = candidatos.map(c => c.userId)
  const convidados = new Set<string>()
  const jaAvisados = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200)
    const [cv, av] = await Promise.all([
      admin.from('family_members').select('user_id').neq('role', 'owner').in('user_id', lote),
      admin.from('aviso_fim_teste').select('user_id, etapa').in('user_id', lote),
    ])
    const falha = cv.error ?? av.error
    if (falha) {
      console.error('[aviso-fim-teste] erro ao selecionar:', falha.code)
      return NextResponse.json({ error: falha.code }, { status: 500 })
    }
    for (const r of cv.data ?? []) convidados.add(r.user_id as string)
    for (const r of av.data ?? []) jaAvisados.add(`${r.user_id}:${r.etapa}`)
  }
  const pendentes = candidatos
    .filter(c => !convidados.has(c.userId) && !jaAvisados.has(`${c.userId}:${c.etapa}`))
    .slice(0, MAX_POR_EXECUCAO)

  let avisados = 0, comBotao = 0, nenhum = 0
  for (const c of pendentes) {
    // Marca ANTES de enviar: a chave primária barra um segundo envio se duas
    // execuções se cruzarem.
    const { data: marca, error: marcaErr } = await admin.from('aviso_fim_teste')
      .insert({ user_id: c.userId, etapa: c.etapa, fim_teste: c.fim.toISOString() }).select('token').single()
    if (marcaErr || !marca) continue

    const r = await enviarAvisoFimTeste(admin, c.userId, c.fim, 'fim_teste', marca.token as string)
    if (r.erros.length) console.error('[aviso-fim-teste] %s %s:', c.etapa, c.userId.slice(0, 8), r.erros.join(' | '))
    if (!r.whatsapp && !r.email) {
      // Nada chegou: tira a marca para tentar de novo amanhã.
      nenhum++
      await admin.from('aviso_fim_teste').delete().eq('user_id', c.userId).eq('etapa', c.etapa)
      continue
    }
    avisados++
    if (r.modelo === 'fim_teste') comBotao++
    await admin.from('aviso_fim_teste').update({ whatsapp: r.whatsapp, email: r.email }).eq('user_id', c.userId).eq('etapa', c.etapa)
  }

  // ── Modelo novo (teste com cartão): avisos antes da primeira cobrança ────
  // 7 dias (só e-mail — regra da Visa), 3 dias e véspera (e-mail + WhatsApp).
  // Quem cancelou no teste não recebe (nada será cobrado). Mesma tabela
  // aviso_fim_teste, para o Painel medir aberturas e cliques.
  const v2 = await avisosModeloNovo(admin, agora)

  const result = { candidatos: pendentes.length, avisados, comBotao, nenhum, modeloNovo: v2 }
  try {
    await admin.from('cron_heartbeats').upsert(
      { name: 'aviso-fim-teste', ran_at: new Date().toISOString(), result },
      { onConflict: 'name' },
    )
  } catch (e) {
    console.error('[aviso-fim-teste] falha ao gravar heartbeat:', e)
  }
  return NextResponse.json(result)
}

function etapaV2(dias: number): 'd7' | 'd3' | 'd1' | null {
  if (dias === 7 || dias === 6) return 'd7'
  if (dias === 3 || dias === 2) return 'd3'
  if (dias === 1 || dias === 0) return 'd1'
  return null
}

async function avisosModeloNovo(admin: ReturnType<typeof createAdminClient>, agora: Date) {
  const { data, error } = await admin
    .from('subscriptions')
    .select('user_id, trial_ends_at')
    .eq('oferta', 'v2')
    .eq('status', 'trialing')
    .eq('cancel_at_period_end', false)
    .gt('trial_ends_at', agora.toISOString())
    .lte('trial_ends_at', new Date(agora.getTime() + 8 * DIA).toISOString())
    .limit(1000)
  if (error) { console.error('[aviso-fim-teste] v2 erro ao ler:', error.code); return { erro: error.code } }

  let enviados = 0, nenhum = 0
  for (const r of data ?? []) {
    const fim = new Date(r.trial_ends_at as string)
    const etapa = etapaV2(diasAte(fim, agora))
    if (!etapa) continue
    const { data: marca, error: e } = await admin.from('aviso_fim_teste')
      .insert({ user_id: r.user_id, etapa, fim_teste: fim.toISOString() }).select('token').single()
    if (e || !marca) continue   // já avisado nesta etapa
    const res = await avisarAntesDaCobranca(r.user_id as string, etapa, marca.token as string)
    if (!res.email && !res.whatsapp) {
      nenhum++
      await admin.from('aviso_fim_teste').delete().eq('user_id', r.user_id).eq('etapa', etapa)
      continue
    }
    enviados++
    await admin.from('aviso_fim_teste').update({ whatsapp: res.whatsapp, email: res.email }).eq('user_id', r.user_id).eq('etapa', etapa)
  }
  return { enviados, nenhum }
}
