// Server-only: envio de mensagens via Meta WhatsApp Cloud API
// e montagem do resumo matinal da família.
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js'
import { toWhatsAppNumber } from './cpf'
import { dosesRealmentePendentes, type VacinaItem } from './docTypes'
import { SCHOOL_KIND_GERAL_FILTER } from './types'
import { vencimentoDe, formatBRL } from './payments'

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
export async function sendWhatsApp(
  to: string,
  content: string | string[],
  // Permite usar OUTRO template que não o do resumo diário. Necessário porque
  // a contagem de parâmetros faz parte do contrato do template: mandar 1
  // parâmetro para um template de 5 é rejeitado pela Meta.
  templateOverride?: string,
): Promise<{ ok: boolean; error?: string; metaResponse?: string }> {
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

  const templateName = templateOverride ?? process.env.WHATSAPP_TEMPLATE_NAME
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

// Mesma trava, para a seção 📌 Lembretes:
//   false (padrão) → template `resumo_diario_v2`, 6 params, sem lembretes
//   true           → template `resumo_diario_v3`, 7 params, com lembretes
// É uma flag SEPARADA de HAS_CLASSES de propósito: assim o cutover v2→v3 é
// uma variável de cada vez, e um erro de digitação degrada para o formato
// anterior em vez de derrubar o envio.
export const templateHasReminders = () =>
  ['true', '1'].includes((process.env.WHATSAPP_TEMPLATE_HAS_REMINDERS ?? '').trim().toLowerCase())

// Mesma trava, para a seção 📝 Provas:
//   false (padrão) → template `resumo_diario_v3`, 7 params, sem provas
//   true           → template `resumo_diario_v4`, 8 params, com provas
export const templateHasExams = () =>
  ['true', '1'].includes((process.env.WHATSAPP_TEMPLATE_HAS_EXAMS ?? '').trim().toLowerCase())

// Mesma trava, para a seção 💰 Mensalidades:
//   false (padrão) → template `resumo_diario_v4`, 8 params
//   true           → template `resumo_diario_v5`, 9 params
// Esta flag também comanda a REORDENAÇÃO das seções (quentes no topo, com
// Hoje antes de Aulas). Ordem é contrato do template: trocar sem trocar o
// template entrega as seções nos títulos errados — falha silenciosa, pior
// que erro. Por isso as duas mudanças andam na mesma chave.
export const templateHasPayments = () =>
  ['true', '1'].includes((process.env.WHATSAPP_TEMPLATE_HAS_PAYMENTS ?? '').trim().toLowerCase())

// Resumo diário em seções — cada posição de `params` vira um {{n}} do
// template Meta; as quebras de linha entre seções ficam no texto fixo do
// template (ver painel-projeto / CLAUDE.md para o corpo aprovado).
export interface DailySummary {
  full: string        // versão texto corrido, para Twilio/texto livre (usa \n\n real)
  // [data, (aulas de hoje), hoje, próximos 7 dias, (lembretes), documentos, vacinas]
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

  // Aulas e provas saem desta consulta e vão para as suas próprias seções.
  // Aula por volume (~45/semana afogariam os compromissos e estourariam o
  // limite de tamanho do parâmetro do template); prova por decisão de
  // produto — ver SCHOOL_KIND_GERAL_FILTER em types.ts.
  const actsQuery = admin
    .from('activities')
    .select('title, category, date, time, takes_user_id, picks_user_id, child:children(name)')
    .gte('date', today)
    .lte('date', weekEnd)
    .neq('status', 'cancelado')
    .or(SCHOOL_KIND_GERAL_FILTER)
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

  // Provas — janela de 7 dias, não só hoje. Uma prova avisada no dia não
  // serve para nada: o valor está em lembrar que ela está chegando, com
  // tempo de estudar. É por isso que esta seção existe apesar de provas
  // terem saído da agenda geral.
  const examQuery = admin
    .from('activities')
    .select('title, date, time, child:children(name)')
    .eq('category', 'escola')
    .eq('school_kind', 'prova')
    .gte('date', today)
    .lte('date', weekEnd)
    .neq('status', 'cancelado')
    .order('date')
    .order('time', { nullsFirst: false })
  const { data: rawExams } = familyIds.length > 0
    ? await examQuery.in('family_id', familyIds)
    : await examQuery.eq('user_id', userId)

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

  // ── Provas dos próximos 7 dias ───────────────────────────────────────────
  // "hoje" e "amanhã" em vez da data seca: é a informação que muda o
  // comportamento de quem lê a mensagem de manhã.
  const examList = (rawExams ?? []) as unknown as
    Array<{ title: string; date: string; time: string | null; child: { name: string } | null }>
  const MAX_EXAMS = 8
  let provasParam = 'Nenhuma prova nos próximos 7 dias.'
  if (examList.length > 0) {
    const amanha = spDate(1)
    const items = examList.slice(0, MAX_EXAMS).map(e => {
      const quando = e.date === today ? 'hoje' : e.date === amanha ? 'amanhã' : fmtShort(e.date)
      const hora = e.time ? ` ${e.time.slice(0, 5)}` : ''
      const childName = e.child?.name ? ` (${e.child.name})` : ''
      return `${quando}${hora} — ${e.title}${childName}`
    })
    if (examList.length > MAX_EXAMS) items.push(`… e mais ${examList.length - MAX_EXAMS} no app`)
    provasParam = items.join(' | ')
  }

  // ── Mensalidades vencidas ou vencendo hoje ───────────────────────────────
  // Sem antecedência, por decisão de produto: avisar antes não muda o
  // comportamento de um PIX. Mas o vencido PERSISTE até ser pago — quem não
  // abriu o WhatsApp no dia exato não pode perder o aviso para sempre.
  const competencia = today.slice(0, 7)

  const payQuery = admin
    .from('payments')
    .select('id, title, amount, due_day, child:children(name)')
    .eq('active', true)
  const { data: rawPayments } = familyIds.length > 0
    ? await payQuery.in('family_id', familyIds)
    : await payQuery.eq('user_id', userId)

  const marksQuery = admin
    .from('payment_marks')
    .select('payment_id')
    .eq('competencia', competencia)
  const { data: rawMarks } = familyIds.length > 0
    ? await marksQuery.in('family_id', familyIds)
    : await marksQuery.eq('user_id', userId)

  const jaPagos = new Set((rawMarks ?? []).map(m => m.payment_id as string))
  const payList = (rawPayments ?? []) as unknown as Array<{
    id: string; title: string; amount: number | null; due_day: number; child: { name: string } | null
  }>

  const mensalidadeLinhas = payList
    .filter(p => !jaPagos.has(p.id))
    .map(p => ({ p, venc: vencimentoDe(competencia, p.due_day) }))
    .filter(x => x.venc <= today)
    .sort((a, b) => a.venc.localeCompare(b.venc))
    .map(({ p, venc }) => {
      const dias = Math.round(
        (new Date(today + 'T12:00:00').getTime() - new Date(venc + 'T12:00:00').getTime()) / 86_400_000)
      const quando = dias === 0 ? 'vence hoje'
        : dias === 1 ? 'venceu ontem'
        : `venceu há ${dias} dias`
      const quem = p.child?.name ? ` (${p.child.name})` : ''
      const valor = p.amount !== null ? ` — ${formatBRL(p.amount)}` : ''
      return `${p.title}${quem}${valor} · ${quando}`
    })

  const mensalidadesParam = mensalidadeLinhas.length > 0
    ? mensalidadeLinhas.join(' | ')
    : 'Nada a pagar hoje ✅'

  // ── Lembretes (mural do Dashboard) ───────────────────────────────────────
  // São `activities` com date NULL: pendências sem data marcada. Concluir um
  // lembrete no mural APAGA a linha (RemindersPanel.handleDone), então não há
  // estado "concluído" para filtrar aqui — o que existe na tabela é pendente.
  // Sem janela de data: um lembrete sem prazo não tem como "vencer", e é
  // justamente por não ter data que ele some da vista e precisa do empurrão.
  const remQuery = admin
    .from('activities')
    .select('title, category, created_at, child:children(name)')
    .is('date', null)
    .neq('status', 'cancelado')
    .order('created_at', { ascending: false })
  const { data: rawReminders } = familyIds.length > 0
    ? await remQuery.in('family_id', familyIds)
    : await remQuery.eq('user_id', userId)

  // Teto menor que o das outras seções: o mural acumula ao longo dos meses e
  // sem limite ele sozinho estouraria o tamanho do parâmetro do template.
  const MAX_REMINDERS = 8
  const reminderList = (rawReminders ?? []) as unknown as
    Array<{ title: string; category: string; child: { name: string } | null }>
  let lembretesParam = 'Nenhum lembrete pendente. 🙌'
  if (reminderList.length > 0) {
    const items = reminderList.slice(0, MAX_REMINDERS).map(r => {
      const emoji = CAT_EMOJI[r.category] ?? '•'
      const childName = r.child?.name ? ` (${r.child.name})` : ''
      return `${emoji} ${r.title}${childName}`
    })
    if (reminderList.length > MAX_REMINDERS) {
      items.push(`… e mais ${reminderList.length - MAX_REMINDERS} no app`)
    }
    lembretesParam = items.join(' | ')
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

  // Doses faltando no comprovante — SEM prazo. Vacina não vence: o cartão
  // registra o que foi aplicado e, quando um bloco impresso está em branco,
  // isso é uma pendência sem data. Antes esta seção usava um "proxima_dose"
  // que o OCR inventava a partir da data da dose seguinte, e anunciava como
  // vencida uma dose que já havia sido tomada.
  const vaccineLines: string[] = []
  for (const doc of vaccineDocs ?? []) {
    const meta = (doc.metadata ?? {}) as Record<string, unknown>
    const pendentes = dosesRealmentePendentes(
      meta.vacinas as VacinaItem[] | undefined,
      meta.doses_pendentes as string[] | undefined,
    )
    if (pendentes.length === 0) continue
    const childName = (doc.child as unknown as { name: string } | null)?.name
    const who = childName ? ` (${childName})` : ''
    vaccineLines.push(`${doc.title}${who} — falta ${pendentes.join(', ')}`)
  }
  const vacinasParam = vaccineLines.length > 0
    ? vaccineLines.join(' | ')
    : 'Nenhuma dose pendente.'

  // O texto corrido (Twilio / texto livre) não passa por template e por isso
  // não tem restrição de contagem: mostra sempre todas as seções.
  const full = [
    `🌿 Bom dia! Resumo da Família — ${dataParam}`,
    `📝 Provas\n${provasParam}`,
    `💰 Mensalidades\n${mensalidadesParam}`,
    `🔥 Hoje\n${hojeParam}`,
    `🎒 Aulas de hoje\n${aulasParam}`,
    `📅 Próximos 7 dias\n${proximosParam}`,
    `📌 Lembretes\n${lembretesParam}`,
    `📄 Documentos — vencimentos\n${documentosParam}`,
    `💉 Vacinas — lembretes\n${vacinasParam}`,
  ].join('\n\n')

  // A ordem aqui É o contrato do template — cada posição vira um {{n}}.
  // Trocar a ordem sem trocar o template aprovado embaralha as seções.
  // Provas vem logo depois da data, espelhando o app (onde o painel abre a
  // tela). Com HAS_EXAMS desligado a sequência resultante é exatamente a do
  // v3 — por isso trocar a posição não quebra quem ainda está no template
  // antigo.
  const params = [dataParam]
  if (templateHasExams()) params.push(provasParam)
  if (templateHasPayments()) {
    // v5 — quentes no topo: Mensalidades logo após Provas, e Hoje antes de
    // Aulas (aula é rotina que se repete; Hoje tem hora, local e logística).
    params.push(mensalidadesParam, hojeParam)
    if (templateHasClasses()) params.push(aulasParam)
    params.push(proximosParam)
  } else {
    // v4 e anteriores — ordem legada, preservada para não embaralhar as
    // seções de quem ainda está no template antigo.
    if (templateHasClasses()) params.push(aulasParam)
    params.push(hojeParam, proximosParam)
  }
  if (templateHasReminders()) params.push(lembretesParam)
  params.push(documentosParam, vacinasParam)

  return { full, params }
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

  // O cron roda a cada 15 min e o dedup é por DIA — sem esta janela, o aviso
  // sairia na primeira execução após a meia-noite, acordando a família às
  // 00:15 para falar de assinatura.
  const hourSP = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
  }).format(new Date()))
  if (hourSP < 9 || hourSP >= 21) {
    return { sent: 0, skipped: 0, failed: 0 }
  }

  // O aviso de conta é UMA frase → precisa de um template de 1 parâmetro.
  // O `resumo_diario` tem 5: mandar 1 para ele é rejeitado pela Meta, que é
  // o motivo de este aviso nunca ter sido entregue. Sem o template próprio
  // configurado, falha de forma barulhenta em vez de silenciosa.
  const accountTemplate = process.env.WHATSAPP_TEMPLATE_ACCOUNT
  if (!accountTemplate && process.env.WHATSAPP_TEMPLATE_NAME) {
    console.error(
      '[grace] WHATSAPP_TEMPLATE_ACCOUNT não configurado — o aviso de grace ' +
      'seria rejeitado pela Meta (contagem de parâmetros). Nenhum envio feito.'
    )
    return { sent: 0, skipped: 0, failed: 0 }
  }

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

      // Texto deliberadamente SEM chamada de compra ("assine", preço, link de
      // planos). O template é da categoria Utilidade, que exige informar o
      // estado da conta; qualquer convite a comprar reclassifica como
      // Marketing — mais caro por conversa, sujeito a limite e ao opt-out do
      // usuário, o que é inaceitável para um aviso de conta. A ação fica no
      // app, para onde o rodapé fixo do template aponta.
      const isOwner = memberId === o.user_id
      const body = isOwner
        ? `O acesso compartilhado da sua família será encerrado ${dayStr}.`
        : `Sua conexão com a família será encerrada ${dayStr}.`

      const result = await sendWhatsApp(number, body, accountTemplate)
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
