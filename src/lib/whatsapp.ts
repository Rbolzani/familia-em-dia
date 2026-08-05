// Server-only: envio de mensagens via Meta WhatsApp Cloud API
// e montagem do resumo matinal da família.
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js'
import { toWhatsAppNumber } from './cpf'

const GRAPH_URL = 'https://graph.facebook.com/v25.0'

// ── Cliente admin (service role — ignora RLS; nunca importar em client components) ──
export function adminClient(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Envio ────────────────────────────────────────────────────────────────────
// Se WHATSAPP_TEMPLATE_NAME estiver configurado, envia via template aprovado
// (obrigatório para mensagens iniciadas pelo negócio fora da janela de 24h).
// Caso contrário envia texto simples (funciona em testes / janela aberta).
// Remove caracteres proibidos em parâmetro de template Meta (erro 132018):
// quebras de linha, tabs e 4+ espaços consecutivos. Usar SEMPRE antes de
// colocar um texto dentro de um {{n}} de template — nunca dentro do texto
// fixo do template em si (esse pode e deve ter quebras de linha reais).
function sanitizeParam(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

// `content` pode ser um texto único (fluxo antigo / mensagens avulsas, como o
// aviso de grace) ou um array de seções (resumo diário — cada posição vira um
// {{n}} do template, e as quebras de linha entre seções ficam no texto fixo
// do template, não no parâmetro). Twilio e texto livre não têm essa restrição
// e usam \n\n real entre seções.
export async function sendWhatsApp(to: string, content: string | string[]): Promise<{ ok: boolean; error?: string; metaResponse?: string }> {
  const isMultiPart = Array.isArray(content)

  // ── Twilio sandbox (teste) ─────────────────────────────────────────────────
  // Se TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN estiverem configurados, usa Twilio.
  // Ideal para validar entrega real antes de ter número de produção na Meta.
  const twilioSid   = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  if (twilioSid && twilioToken) {
    const body = isMultiPart ? content.join('\n\n') : content
    const params = new URLSearchParams({
      From: 'whatsapp:+14155238886',   // número sandbox fixo da Twilio
      To:   `whatsapp:+${to}`,
      Body: body,
    })
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    )
    const resText = await res.text()
    if (!res.ok) return { ok: false, error: `Twilio HTTP ${res.status}: ${resText}` }
    return { ok: true, metaResponse: resText }
  }

  // ── Meta WhatsApp Cloud API (produção) ────────────────────────────────────
  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) return { ok: false, error: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID não configurados' }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME
  let payload: Record<string, unknown>
  if (templateName === 'hello_world') {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    }
  } else if (templateName) {
    const parts = isMultiPart ? content : [content]
    const parameters = parts.map(p => ({ type: 'text', text: sanitizeParam(p) }))
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters }],
      },
    }
  } else {
    const body = isMultiPart ? content.join('\n\n') : content
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body } }
  }

  const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const resText = await res.text()
  if (!res.ok) return { ok: false, error: `Meta HTTP ${res.status}: ${resText}` }
  return { ok: true, metaResponse: resText }
}

// ── Datas no fuso de São Paulo ───────────────────────────────────────────────
// Usa aritmética em milissegundos para evitar bugs de "dia errado" ao cruzar
// a meia-noite UTC com o fuso America/Sao_Paulo (UTC-3).
function spDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
function fmtShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return `${WEEKDAYS[d.getDay()]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`
}

const CAT_EMOJI: Record<string, string> = { escola: '📘', saude: '🩺', extracurricular: '⭐' }

interface SummaryActivity {
  title: string
  category: string
  date: string
  time: string | null
  takes_user_id: string | null
  picks_user_id: string | null
  child: { name: string } | null
}

// A seção "Aulas de hoje" só é enviada quando o template APROVADO na Meta
// tem os 6 parâmetros. Enviar 6 para um template de 5 (ou vice-versa) faz a
// Meta rejeitar a mensagem inteira, então a contagem é explícita aqui:
//   false (padrão) → 5 params, template `resumo_diario` legado
//   true           → 6 params, template `resumo_diario_v2` com 🎒 Aulas
// No cutover, trocar junto com WHATSAPP_TEMPLATE_NAME na Vercel.
// Tolerante a "true"/"TRUE"/"1": um valor digitado com outra caixa no painel
// da Vercel cairia silenciosamente em 5 params e quebraria o template v2.
export const templateHasClasses = () =>
  ['true', '1'].includes((process.env.WHATSAPP_TEMPLATE_HAS_CLASSES ?? '').trim().toLowerCase())

// Resumo diário em seções — cada posição de `params` vira um {{n}} do
// template Meta; as quebras de linha entre seções ficam no texto fixo do
// template (ver painel-projeto / CLAUDE.md para o corpo aprovado).
export interface DailySummary {
  full: string        // versão texto corrido, para Twilio/texto livre (usa \n\n real)
  // [data, (aulas de hoje), hoje, próximos 7 dias, documentos, vacinas]
  params: string[]
}

// ── Monta o resumo do dia + próximos 7 dias para um usuário ─────────────────
// Retorna null se o usuário não tiver nenhuma atividade no período.
export async function buildDailySummary(admin: SupabaseClient, userId: string): Promise<DailySummary | null> {
  // Usuários da família (o próprio + parceiros)
  const { data: myMemberships } = await admin
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId)

  const familyIds = (myMemberships ?? []).map(m => m.family_id)

  // Nomes para leva/busca (relativo ao destinatário). Havia duas consultas
  // idênticas a family_members aqui — a primeira alimentava um `userIds` que
  // nunca era lido. Uma só, portanto.
  const names = new Map<string, string>()
  if (familyIds.length > 0) {
    const { data: mems } = await admin
      .from('family_members')
      .select('user_id, display_name')
      .in('family_id', familyIds)
    for (const m of mems ?? []) names.set(m.user_id, m.display_name ?? 'Parceiro(a)')
  }
  const who = (id: string | null) => (id ? (id === userId ? 'Você' : names.get(id) ?? 'Parceiro(a)') : null)

  const today = spDate(0)
  const weekEnd = spDate(7)

  // A rotina de aulas sai desta consulta e vai para a sua própria seção (só
  // as de HOJE): na semana são ~45 aulas, que afogariam os compromissos e
  // estourariam o limite de tamanho do parâmetro do template da Meta. `or`
  // com is.null é obrigatório: `neq` sozinho descartaria as atividades
  // normais, que têm school_kind NULL.
  const actsQuery = admin
    .from('activities')
    .select('title, category, date, time, takes_user_id, picks_user_id, child:children(name)')
    .gte('date', today)
    .lte('date', weekEnd)
    .neq('status', 'cancelado')
    .or('school_kind.is.null,school_kind.neq.aula')
    .order('date')
    .order('time', { nullsFirst: false })

  const { data: acts } = familyIds.length > 0
    ? await actsQuery.in('family_id', familyIds)
    : await actsQuery.eq('user_id', userId)

  const seen = new Set<string>()
  const activities = ((acts ?? []) as unknown as SummaryActivity[]).filter(a => {
    const key = `${a.date}|${a.title}|${a.child?.name ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const todayActs = activities.filter(a => a.date === today)
  const nextActs = activities.filter(a => a.date > today)

  // Aulas de hoje — consulta própria, só a grade do dia.
  const classQuery = admin
    .from('activities')
    .select('title, time, child:children(name)')
    .eq('category', 'escola')
    .eq('school_kind', 'aula')
    .eq('date', today)
    .neq('status', 'cancelado')
    .order('time', { nullsFirst: false })
  const { data: rawClasses } = familyIds.length > 0
    ? await classQuery.in('family_id', familyIds)
    : await classQuery.eq('user_id', userId)

  // Plano efetivo da família = plano do owner (ativo/trial). A agenda diária é
  // recurso PAGO; o aviso de grace é notificação de conta e é tratado à parte
  // (ver runGraceNotices) — por isso não entra mais neste resumo.
  let familyIsPaid = false
  if (familyIds.length > 0) {
    const { data: families } = await admin
      .from('families').select('created_by').in('id', familyIds)
    const ownerIds = [...new Set((families ?? []).map(f => f.created_by as string))]
    if (ownerIds.length > 0) {
      const { data: subs } = await admin
        .from('subscriptions').select('plan, status').in('user_id', ownerIds)
      familyIsPaid = (subs ?? []).some(s =>
        s.plan !== 'free' && (s.status === 'active' || s.status === 'trialing'))
    }
  } else {
    const { data: ownSub } = await admin
      .from('subscriptions').select('plan, status').eq('user_id', userId).maybeSingle()
    familyIsPaid = !!ownSub && ownSub.plan !== 'free' &&
      (ownSub.status === 'active' || ownSub.status === 'trialing')
  }

  // Free não recebe a agenda. Sem atividades, o resumo ainda é enviado — as
  // seções já têm texto de fallback ("Nenhuma atividade...") — pois pular o
  // envio silenciosamente fazia o resumo diário parecer instável (chegava só
  // em dias com atividade, nunca em dias tranquilos).
  if (!familyIsPaid) return null

  // Cada seção vira uma linha própria no WhatsApp: no template, o texto fixo
  // já tem a quebra de linha entre seções — aqui só juntamos os itens DENTRO
  // de cada seção com " | " (o parâmetro do template não pode ter \n real).
  const dataParam = fmtShort(today)

  // ── Aulas de hoje ────────────────────────────────────────────────────────
  // O nome do filho só entra quando há aula de mais de um filho no dia: com
  // um filho só ele seria repetido em todas as linhas sem informar nada.
  const classList = (rawClasses ?? []) as unknown as Array<{ title: string; time: string | null; child: { name: string } | null }>
  const classChildren = new Set(classList.map(c => c.child?.name).filter(Boolean))
  const MAX_CLASSES = 14
  let aulasParam = 'Nenhuma aula hoje 🎒'
  if (classList.length > 0) {
    const items = classList.slice(0, MAX_CLASSES).map(c => {
      const hora = c.time ? `${c.time.slice(0, 5)} ` : ''
      const quem = classChildren.size > 1 && c.child?.name ? ` (${c.child.name})` : ''
      return `${hora}${c.title}${quem}`
    })
    if (classList.length > MAX_CLASSES) items.push(`… e mais ${classList.length - MAX_CLASSES} no app`)
    aulasParam = items.join(' | ')
  }

  let hojeParam: string
  if (todayActs.length > 0) {
    const items = todayActs.map(a => {
      const emoji = CAT_EMOJI[a.category] ?? '•'
      const time = a.time ? ` (${a.time.slice(0, 5)})` : ''
      const childName = a.child?.name ? `${a.child.name} — ` : ''
      const parts = [`${emoji} ${childName}${a.title}${time}`]
      const leva = who(a.takes_user_id)
      const busca = who(a.picks_user_id)
      if (leva) parts.push(`🚗 leva: ${leva}`)
      if (busca) parts.push(`🏠 busca: ${busca}`)
      return parts.join(' · ')
    })
    hojeParam = items.join(' | ')
  } else {
    hojeParam = 'Nenhuma atividade hoje. Aproveite! 💚'
  }

  let proximosParam = 'Nenhuma atividade nos próximos 7 dias.'
  if (nextActs.length > 0) {
    const items = nextActs.slice(0, 8).map(a => {
      const childName = a.child?.name ? ` (${a.child.name})` : ''
      return `${fmtShort(a.date)} — ${a.title}${childName}`
    })
    if (nextActs.length > 8) items.push(`… e mais ${nextActs.length - 8} no app`)
    proximosParam = items.join(' | ')
  }

  // Documentos vencidos ou vencendo nos próximos 15 dias
  const docExpiryQuery = admin
    .from('documents')
    .select('title, category, expires_at, child:children(name)')
    .not('expires_at', 'is', null)
    .lte('expires_at', spDate(15))
    .order('expires_at')
  const { data: expiringDocs } = familyIds.length > 0
    ? await docExpiryQuery.in('family_id', familyIds)
    : await docExpiryQuery.eq('user_id', userId)

  let documentosParam = 'Nenhum vencimento nos próximos 15 dias.'
  if (expiringDocs && expiringDocs.length > 0) {
    const items = expiringDocs.map(d => {
      const childName = (d.child as unknown as { name: string } | null)?.name
      const daysLeft = Math.ceil((new Date(d.expires_at + 'T23:59:59').getTime() - Date.now()) / 86_400_000)
      const status = daysLeft < 0
        ? `vencido há ${Math.abs(daysLeft)} dia${Math.abs(daysLeft) !== 1 ? 's' : ''}`
        : daysLeft === 0 ? 'vence hoje'
        : daysLeft === 1 ? 'vence amanhã'
        : `vence em ${daysLeft} dias`
      const who = childName ? ` (${childName})` : ''
      return `${d.title}${who} — ${status}`
    })
    documentosParam = items.join(' | ')
  }

  // Vacinas com próxima dose vencida ou nos próximos 30 dias
  const vaccineQuery = admin
    .from('documents')
    .select('title, metadata, child:children(name)')
    .eq('doc_type', 'vacinacao')
  const { data: vaccineDocs } = familyIds.length > 0
    ? await vaccineQuery.in('family_id', familyIds)
    : await vaccineQuery.eq('user_id', userId)

  const vaccineLines: string[] = []
  const cutoff = spDate(30)  // próximos 30 dias
  for (const doc of vaccineDocs ?? []) {
    const vacinas = ((doc.metadata as Record<string, unknown>)?.vacinas ?? []) as Array<{ nome?: string; proxima_dose?: string | null }>
    for (const v of vacinas) {
      if (!v.proxima_dose || !v.nome) continue
      if (v.proxima_dose > cutoff) continue  // mais de 30 dias, pula
      const childName = (doc.child as unknown as { name: string } | null)?.name
      const daysLeft = Math.ceil((new Date(v.proxima_dose + 'T23:59:59').getTime() - Date.now()) / 86_400_000)
      const status = daysLeft < 0
        ? `vencida há ${Math.abs(daysLeft)} dia${Math.abs(daysLeft) !== 1 ? 's' : ''}`
        : daysLeft === 0 ? 'hoje!'
        : daysLeft === 1 ? 'amanhã'
        : `em ${daysLeft} dias`
      const who = childName ? ` (${childName})` : ''
      vaccineLines.push(`${v.nome}${who} — dose ${status}`)
    }
  }
  const vacinasParam = vaccineLines.length > 0
    ? vaccineLines.join(' | ')
    : 'Nenhuma dose prevista nos próximos 30 dias.'

  const full = [
    `🌿 Bom dia! Resumo da Família — ${dataParam}`,
    `🎒 Aulas de hoje\n${aulasParam}`,
    `🔥 Hoje\n${hojeParam}`,
    `📅 Próximos 7 dias\n${proximosParam}`,
    `📄 Documentos — vencimentos\n${documentosParam}`,
    `💉 Vacinas — lembretes\n${vacinasParam}`,
  ].join('\n\n')

  return {
    full,
    params: templateHasClasses()
      ? [dataParam, aulasParam, hojeParam, proximosParam, documentosParam, vacinasParam]
      : [dataParam, hojeParam, proximosParam, documentosParam, vacinasParam],
  }
}

// ── Número de WhatsApp do usuário ────────────────────────────────────────────
// Precedência: número definido em /alertas (override) → celular do cadastro.
// Retorna no formato de envio (55 + DDD + número) ou null se não houver válido.
export async function resolveWhatsAppNumber(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: ns } = await admin
    .from('notification_settings')
    .select('whatsapp_number')
    .eq('user_id', userId)
    .maybeSingle()
  if (ns?.whatsapp_number) {
    const n = toWhatsAppNumber(ns.whatsapp_number)
    if (n) return n
  }
  const { data: prof } = await admin
    .from('profiles')
    .select('phone')
    .eq('user_id', userId)
    .maybeSingle()
  return toWhatsAppNumber(prof?.phone)
}

// ── Avisos de grace period (notificação de conta) ────────────────────────────
// Independe do toggle de resumo diário e do horário escolhido. Envia a cada
// membro da família em graça, usando o número resolvido (override → cadastro),
// no máximo uma vez por dia (dedup via notification_settings.last_grace_notice_on).
export async function runGraceNotices(admin: SupabaseClient): Promise<{ sent: number; skipped: number; failed: number }> {
  const today = spDate(0)
  let sent = 0, skipped = 0, failed = 0

  const { data: owners } = await admin
    .from('subscriptions')
    .select('user_id, partner_grace_until')
    .eq('plan', 'free')
    .not('partner_grace_until', 'is', null)
    .gt('partner_grace_until', new Date().toISOString())

  for (const o of owners ?? []) {
    const graceEnd = new Date(o.partner_grace_until as string)
    const daysLeft = Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / 86_400_000))
    const dayStr = daysLeft <= 1 ? 'hoje' : `em ${daysLeft} dias`

    const { data: fam } = await admin
      .from('families').select('id').eq('created_by', o.user_id).maybeSingle()
    if (!fam?.id) continue

    const { data: members } = await admin
      .from('family_members').select('user_id').eq('family_id', fam.id)

    for (const m of members ?? []) {
      const memberId = m.user_id as string

      // Dedup: já enviou hoje?
      const { data: ns } = await admin
        .from('notification_settings').select('last_grace_notice_on').eq('user_id', memberId).maybeSingle()
      if (ns?.last_grace_notice_on === today) { skipped++; continue }

      const number = await resolveWhatsAppNumber(admin, memberId)
      if (!number) { skipped++; continue }

      const isOwner = memberId === o.user_id
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.familiaemdia.com.br'
      const body = isOwner
        ? `🌿 *Família em Dia*\n\n⚠️ *Atenção:* seu parceiro(a) será desconectado ${dayStr}. Assine um plano para manter o acesso compartilhado: ${appUrl}/planos`
        : `🌿 *Família em Dia*\n\n⚠️ *Atenção:* sua conexão com a família será encerrada ${dayStr}. Peça ao responsável que assine o plano Família para manter seu acesso.`

      const result = await sendWhatsApp(number, body)
      if (result.ok) sent++; else { failed++; console.error(`[grace] falha p/ ${memberId}:`, result.error) }

      // Marca como enviado hoje (mesmo em falha, evita retry no mesmo dia).
      await admin.from('notification_settings').upsert(
        { user_id: memberId, last_grace_notice_on: today, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    }
  }

  return { sent, skipped, failed }
}
