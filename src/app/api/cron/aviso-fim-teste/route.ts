// Aviso de fim do teste grátis (Vercel Cron, 1×/dia às 9h de Brasília).
//
// Para quem está no teste do Família, ainda não assinou e tem o teste
// terminando nos próximos 3 dias, manda UMA vez: WhatsApp (estado da conta,
// pelo template `aviso_conta`) e e-mail (o que deixa de funcionar, preço,
// botão para assinar e a tabela comparativa). Textos em src/lib/aviso-fim-teste.ts.
//
// Quem fica de fora: quem já assinou no teste (tem assinatura no Stripe),
// convidados por link (usam o plano de outra família) e contas cortesia (não
// estão em teste). Controle em `aviso_fim_teste` (MIGRATION_aviso_fim_teste.sql).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmail } from '@/lib/email'
import { LEGAL_ENTITY } from '@/lib/legal'
import { resolveWhatsAppNumber, sendWhatsApp } from '@/lib/whatsapp'
import { REMETENTE_AVISO, assuntoEmail, avisoWhatsApp, emailEmHtml, emailEmTexto } from '@/lib/aviso-fim-teste'

export const maxDuration = 60

const DIA = 86_400_000
// Janela: termina em até 3 dias e ainda faltam mais de 12 horas. Uma execução
// perdida não perde o aviso — o dia seguinte ainda pega (com "em 2 dias").
const ATE_MS = 3 * DIA
const MINIMO_MS = 12 * 3_600_000
const MAX_POR_EXECUCAO = 100

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const agora = Date.now()

  const { data: emTeste, error } = await admin
    .from('subscriptions')
    .select('user_id, trial_ends_at')
    .eq('status', 'trialing')
    .is('stripe_subscription_id', null)
    .gt('trial_ends_at', new Date(agora + MINIMO_MS).toISOString())
    .lte('trial_ends_at', new Date(agora + ATE_MS).toISOString())
    .limit(1000)
  if (error) {
    console.error('[aviso-fim-teste] erro ao ler assinaturas:', error.code)
    return NextResponse.json({ error: error.code }, { status: 500 })
  }

  const ids = (emTeste ?? []).map(r => r.user_id as string)
  const fora = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200)
    const [convidados, avisados] = await Promise.all([
      admin.from('family_members').select('user_id').neq('role', 'owner').in('user_id', lote),
      admin.from('aviso_fim_teste').select('user_id').in('user_id', lote),
    ])
    const falha = convidados.error ?? avisados.error
    if (falha) {
      console.error('[aviso-fim-teste] erro ao selecionar:', falha.code)
      return NextResponse.json({ error: falha.code }, { status: 500 })
    }
    for (const r of [...(convidados.data ?? []), ...(avisados.data ?? [])]) fora.add(r.user_id as string)
  }
  const pendentes = (emTeste ?? []).filter(r => !fora.has(r.user_id as string)).slice(0, MAX_POR_EXECUCAO)

  const template = process.env.WHATSAPP_TEMPLATE_ACCOUNT
  let avisados = 0, soWhatsapp = 0, soEmail = 0, nenhum = 0
  for (const r of pendentes) {
    const userId = r.user_id as string
    const fim = new Date(r.trial_ends_at as string)

    // Marca ANTES de enviar: a chave primária barra um segundo envio se duas
    // execuções se cruzarem.
    const { error: marcaErr } = await admin.from('aviso_fim_teste').insert({ user_id: userId, fim_teste: fim.toISOString() })
    if (marcaErr) continue

    // WhatsApp: só com o template de aviso de conta configurado (1 parâmetro).
    let whatsapp = false
    const numero = template ? await resolveWhatsAppNumber(admin, userId) : null
    if (numero) {
      const w = await sendWhatsApp(numero, avisoWhatsApp(fim), template, { userId, kind: 'fim_teste' })
      whatsapp = w.ok
      if (!w.ok) console.error('[aviso-fim-teste] WhatsApp falhou:', w.error)
    }

    // E-mail: só para e-mail confirmado.
    let email = false
    const { data: u } = await admin.auth.admin.getUserById(userId)
    if (u.user?.email && u.user.email_confirmed_at) {
      const { data: perfil } = await admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle()
      const nome = (perfil?.full_name as string | null)?.trim().split(/\s+/)[0] || null
      const e = await enviarEmail(u.user.email, assuntoEmail(fim), emailEmHtml(nome, fim), emailEmTexto(nome, fim),
        { de: REMETENTE_AVISO, responderPara: LEGAL_ENTITY.email })
      email = e.ok
      if (!e.ok) console.error('[aviso-fim-teste] e-mail falhou:', e.naoConfigurado ? 'sem RESEND_API_KEY' : e.erro)
    }

    if (!whatsapp && !email) {
      // Nada chegou: tira a marca para tentar de novo amanhã.
      nenhum++
      await admin.from('aviso_fim_teste').delete().eq('user_id', userId)
      continue
    }
    avisados++
    if (whatsapp && !email) soWhatsapp++
    if (email && !whatsapp) soEmail++
    await admin.from('aviso_fim_teste').update({ whatsapp, email }).eq('user_id', userId)
  }

  const result = { candidatos: pendentes.length, avisados, soWhatsapp, soEmail, nenhum, semTemplate: !template }

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
