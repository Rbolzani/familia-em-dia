import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, getAiUsageThisMonth, incrementAiUsage, PLAN_LIMITS } from '@/lib/billing'
import { normalizeImage } from '@/lib/image'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Extração de imagem com thinking pode levar mais que os 10s padrão do
// Vercel Hobby, especialmente em grades de horário densas.
export const maxDuration = 60

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 12_000

// Data "de hoje" no fuso de Brasília, calculada POR REQUISIÇÃO. Dois motivos:
// (1) o servidor da Vercel roda em UTC — toISOString() daria o dia errado à
//     noite no Brasil (após 21h BRT, em UTC já é o dia seguinte), fazendo a IA
//     entender "amanhã" como +2 dias; (2) se fosse const de módulo, a data
//     ficaria congelada no cold start. 'en-CA' formata como YYYY-MM-DD; 'pt-BR'
//     long dá o dia da semana no mesmo formato de WEEKDAY_NAMES.
function spTodayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}
function spTodayWeekday(): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date())
}

function buildPrompt(): string {
  const todayISO = spTodayISO()
  const todayWeekday = spTodayWeekday()
  return `Você é um assistente inteligente que analisa conteúdo enviado por pais e classifica automaticamente em quatro categorias distintas.

Hoje é: ${todayISO} (${todayWeekday})

Analise o conteúdo e classifique cada item em exatamente uma das quatro categorias:

**CATEGORIA 1 — activities (Atividades / Compromissos / Agenda)**
Itens que têm uma data específica em que algo VAI ACONTECER:
- Provas e trabalhos escolares (têm data de realização/entrega)
- Consultas médicas, exames, vacinas (têm data agendada)
- Eventos escolares (reuniões, festas, apresentações)
- Atividades extracurriculares recorrentes (futebol toda terça)
- Qualquer compromisso com data/horário definido

**GRADES DE HORÁRIO ESCOLAR (regra importante)** — Se a imagem for uma tabela/grade de horários com colunas por dia da semana (ex: "2ª", "3ª", "4ª", "5ª", "6ª" ou "Segunda", "Terça"...) e linhas por período/horário, isso é uma AGENDA RECORRENTE (se repete toda semana), não um documento nem um lembrete. Trate CADA célula preenchida com uma matéria/atividade como um item separado em "activities":
- title: nome da matéria/atividade da célula (ex: "Geografia", "Xadrez", "Educação Física")
- category: "escola"
- date: calcule a data real (YYYY-MM-DD) da PRÓXIMA ocorrência daquele dia da semana — use a data mais próxima a partir de hoje (se esse dia da semana já passou nesta semana, use a mesma data na semana seguinte). Gere apenas UMA data (a primeira ocorrência) — não repita o item várias vezes para semanas futuras, isso é feito depois por outro processo.
- time: horário de início do período daquela linha (HH:MM)
- recurring: true (marca que esse item se repete toda semana no mesmo dia/horário)
- Gere um item para CADA célula preenchida da grade, mesmo que o total seja alto (dezenas de itens) — nunca resuma, agrupe ou pule células.
- Inclua TAMBÉM as células de intervalo/refeição (ex: "Lanche/Recreio", "Almoço/Recreio", "Lanche/Saída") como itens normais — a exclusão delas é feita depois por outro processo automaticamente; você não precisa (e não deve tentar) filtrá-las.
- Antes de responder, confira mentalmente linha por linha, coluna por coluna: o número de itens gerados para a grade deve ser exatamente igual ao número de células preenchidas na tabela (linhas × colunas). Não pule nenhuma célula.
Uma grade de horários NUNCA deve virar um item em "documents" nem em "reminders".
Para atividades com data específica e única (prova, consulta, evento — categoria 1 normal), use "recurring": false.

**CATEGORIA 2 — reminders (Pendências / Lembretes)**
Ações que precisam ser feitas, mas SEM data específica de ocorrência:
- Coisas para comprar, providenciar ou renovar
- Documentos para solicitar ou entregar
- Ligações a fazer, formulários a preencher
- Tarefas sem prazo definido
- Lembretes gerais ("precisa renovar carteirinha", "comprar material")
- Rotinas mencionadas sem quando ("levar a Gabi na escola", "buscar o João")

**REGRA CRÍTICA — nunca invente uma data.** Se o conteúdo não disser
explicitamente QUANDO algo acontece, o item é um **reminder**, não uma
activity. Só existe data quando ela está no conteúdo, seja absoluta
("15/06", "dia 20") ou relativa ("amanhã", "sexta que vem", "toda terça").
Exemplos: "levar Gabi na escola" → reminder (não diz quando).
"levar Gabi na escola amanhã" → activity com data.
"levar Gabi na escola toda segunda" → activity recorrente.
Na dúvida entre activity sem data e reminder, escolha SEMPRE reminder.

NÃO crie um reminder a partir de avisos/disclaimers genéricos de comunicados (ex: "este horário poderá sofrer alterações ao longo do ano letivo", "sujeito a mudanças", rodapés padrão de escola) — isso não é uma ação que o pai/mãe precisa tomar, é só um aviso legal do documento. Só crie reminder se houver uma ação real e específica pedida.

**CATEGORIA 3 — documents (Documentos)**
Documentos físicos ou digitais identificados no conteúdo:
- Documentos de identidade (RG, CPF, certidão de nascimento, passaporte)
- Documentos de saúde (receitas, resultados de exames, plano de saúde)
- Documentos escolares (boletins, declarações, grades de horário, comunicados formais da escola)
- Comprovantes de vacinação (carteira de vacinação)
- Contratos (matrícula, plano de saúde, seguro, locação)
- Carteirinhas (estudante, plano de saúde, clube)
- Autorizações (viagem, uso de imagem, retirada de terceiros)
- Boletos, recibos ou comprovantes financeiros
- Qualquer outro documento formal listado ou visível

**CATEGORIA 4 — payments (Mensalidades / Pagamentos recorrentes)**
Compromissos financeiros que se REPETEM todo mês num dia fixo:
- Mensalidade de atividade extracurricular (natação, ginástica, piano, judô)
- Pagamento recorrente de profissional (pedagoga, psicóloga, fonoaudióloga)
- Mensalidade escolar, do plano de saúde, do transporte escolar
Exemplos: "pagar natação todo dia 10, R$ 280" · "mensalidade do piano vence
dia 5, 250 reais" · "a psicopedagoga custa 1600 por mês, pago dia 15".

**Como distinguir de um lembrete ou de um documento:**
- Tem valor E dia do mês E se repete → **payment**.
- "Pagar a natação até sexta" (uma vez só, sem dia fixo mensal) → reminder.
- Foto de um boleto ou comprovante de PIX já pago → **document** (financeiro),
  não payment. Payment é a REGRA recorrente, não o comprovante de uma
  parcela.
- Se faltar o dia do mês, NÃO invente: vira reminder. O valor pode faltar
  (use null), mas o dia é obrigatório para ser um payment.

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem explicação):
{
  "activities": [
    {
      "title": "título curto (máx 80 chars)",
      "category": "escola",
      "date": "YYYY-MM-DD ou null",
      "time": "HH:MM ou null",
      "description": "detalhes adicionais ou null",
      "location": "local ou null",
      "recurring": false,
      "recurring_weeks": null
    }
  ],
  "reminders": [
    {
      "title": "título curto (máx 80 chars)",
      "category": "escola",
      "description": "contexto adicional ou null",
      "child_hint": "nome do filho se mencionado, ou null"
    }
  ],
  "documents": [
    {
      "title": "nome do documento",
      "category": "saude",
      "description": "detalhes do documento ou null",
      "expires_at": "YYYY-MM-DD ou null"
    }
  ],
  "payments": [
    {
      "title": "nome curto do que se paga (máx 80 chars), ex.: Natação",
      "amount": 280.0,
      "due_day": 10,
      "notes": "forma de pagamento ou observação, ou null",
      "child_hint": "nome do filho se mencionado, ou null"
    }
  ]
}

Regras para reminders:
- category: exatamente "escola", "saude" ou "extracurricular" — escolha a que melhor descreve a natureza da pendência
- escola: coisas relacionadas à escola, material, reuniões sem data
- saude: renovar plano de saúde, agendar consulta, buscar receita
- extracurricular: inscrições, renovações de atividades

Regras para activities:
- category: exatamente "escola", "saude" ou "extracurricular"
- escola: provas, trabalhos, eventos escolares, reuniões de pais, tarefas com data
- saude: consultas, vacinas, exames, retornos médicos
- extracurricular: esportes, cursos, hobbies, competições
- date: calcule datas relativas a partir de hoje se necessário; null se incerta
- recurring: true SOMENTE se o conteúdo expressar recorrência explícita
  ("toda terça", "às segundas", "semanalmente") ou for uma grade de horário
  escolar. Rotina implícita ou hábito não é recorrência — se o conteúdo não
  disser a frequência com essas palavras, use recurring: false.
- recurring_weeks: por quantas SEMANAS a recorrência deve valer, quando o
  conteúdo disser um limite. Converta o que o usuário falou para semanas:
  "por 4 semanas" → 4 · "durante 2 meses" → 8 · "até o fim do mês" → conte as
  semanas a partir de hoje · "3 vezes" → 3. Se o conteúdo NÃO indicar limite
  algum (incluindo grades de horário escolar), use null.

Regras para documents:
- category: exatamente "saude", "identidade", "contratos", "carteirinhas", "escolar", "vacinacao", "autorizacoes", "financeiro" ou "outros"
- saude: receitas, resultados de exames, atestados médicos
- identidade: RG, CPF, certidão de nascimento, passaporte, CNH
- contratos: matrícula escolar, contrato de plano de saúde, seguros, locação
- carteirinhas: carteirinha de estudante, clube, plano de saúde físico
- escolar: boletins, declarações escolares, grades/horários de aula, comunicados formais da escola
- vacinacao: carteira ou comprovante de vacinação
- autorizacoes: autorização de viagem, uso de imagem, retirada de terceiros na escola
- financeiro: boletos, recibos, comprovantes de pagamento
- outros: qualquer documento que não se encaixe nas anteriores
- expires_at: data de validade se visível ou mencionada

Regras para payments:
- due_day: número inteiro de 1 a 31, o dia do mês em que vence. OBRIGATÓRIO —
  sem ele o item não é payment, é reminder.
- amount: número decimal em reais, sem símbolo e sem separador de milhar
  ("R$ 1.640,00" → 1640.0). Use null se o valor não for mencionado.
- title: só o nome da atividade ou serviço ("Natação"), sem o verbo pagar e
  sem o valor — eles já aparecem em outros campos da tela.
- Nunca crie payment a partir de uma parcela avulsa ou de um comprovante.

Se não houver itens de uma categoria, retorne array vazio [].
Retorne apenas o JSON, sem texto antes ou depois.`
}

export interface ExtractedPayment {
  title: string
  amount: number | null
  due_day: number
  notes: string | null
  child_hint: string | null
}

/**
 * Trava determinística sobre a saída da IA para mensalidades.
 *
 * `due_day` é o que separa uma mensalidade de um lembrete, e o prompt já diz
 * para não inventá-lo — mas prompt é pedido, não garantia. Um `due_day` fora
 * de 1..31 violaria o CHECK do banco e derrubaria o salvamento inteiro do
 * lote; aqui o item apenas é descartado. Valores em string ("280,00") também
 * são normalizados, porque o modelo às vezes devolve o número formatado.
 */
function sanitizePayments(raw: unknown): ExtractedPayment[] {
  if (!Array.isArray(raw)) return []
  const out: ExtractedPayment[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 80) : ''
    if (!title) continue

    const dia = Number(o.due_day)
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) continue

    let amount: number | null = null
    if (typeof o.amount === 'number' && Number.isFinite(o.amount)) {
      amount = o.amount
    } else if (typeof o.amount === 'string') {
      const n = Number(o.amount.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
      amount = Number.isFinite(n) ? n : null
    }
    if (amount !== null && (amount < 0 || amount > 1_000_000)) amount = null

    out.push({
      title,
      amount,
      due_day: dia,
      notes: typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null,
      child_hint: typeof o.child_hint === 'string' && o.child_hint.trim() ? o.child_hint.trim() : null,
    })
  }
  return out
}

// Horizonte PADRÃO de materialização (recurring: true) — a tabela activities
// não tem conceito de recorrência, então cada ocorrência semanal vira uma
// linha própria. Vale só quando o conteúdo não define um limite: "toda terça
// por 4 semanas" respeita as 4 (recurring_weeks); grade de horário escolar,
// que não tem condição de contorno, usa este padrão.
const RECURRING_WEEKS = 12
const MAX_RECURRING_WEEKS = 52

interface ExtractedActivity {
  title: string
  category: string
  date: string | null
  time: string | null
  description?: string | null
  location?: string | null
  recurring?: boolean
  recurring_weeks?: number | null
  groupId?: string
}

// Filtro determinístico de períodos de intervalo/refeição — a IA nem sempre
// aplica essa exclusão de forma consistente entre execuções (observado em
// produção: a mesma grade ora incluía Almoço/Recreio, ora não). Em vez de
// depender só do prompt, garantimos isso em código.
const BREAK_KEYWORDS = ['recreio', 'almoço', 'almoco', 'lanche', 'saída', 'saida', 'intervalo']
function isBreakPeriod(title: string): boolean {
  const t = title.toLowerCase()
  return BREAK_KEYWORDS.some(k => t.includes(k))
}

// Recorrência explícita na entrada de texto. A IA às vezes marca
// recurring:true e inventa uma data-âncora para pedidos que não têm nem data
// nem frequência ("levar Gabi na escola") — o item vira 12 ocorrências no
// calendário em vez de um lembrete no mural. Quando a entrada é texto dá para
// conferir isso de forma determinística, sem depender do prompt.
const RECURRENCE_RE = /\b(tod[oa]s?\s+[oa]?s?\s*\w+|semanal(mente)?|quinzenal(mente)?|diariamente|segundas|ter[çc]as|quartas|quintas|sextas|s[áa]bados|domingos)\b/i

// Sem marcador de recorrência, uma data que só existe para ancorar a série é
// fabricada — zerá-la devolve o item para Pendências/Lembretes (date = null).
function stripFabricatedRecurrence(acts: ExtractedActivity[]): ExtractedActivity[] {
  return acts.map(a => (a.recurring ? { ...a, recurring: false, date: null } : a))
}

// Cada ocorrência gerada de um mesmo item recorrente leva o mesmo groupId,
// para a tela de revisão poder agrupá-las (uma matéria = um card, não 12).
function expandRecurring(activities: ExtractedActivity[]): ExtractedActivity[] {
  const result: ExtractedActivity[] = []
  activities.forEach((act, idx) => {
    if (isBreakPeriod(act.title)) return
    if (!act.recurring || !act.date) { result.push({ ...act, recurring: false }); return }
    const groupId = `rec-${idx}-${act.title}-${act.time}`
    // Limite dito pelo usuário manda; sem ele, cai no horizonte padrão.
    const asked = Number(act.recurring_weeks)
    const weeks = Number.isFinite(asked) && asked >= 1
      ? Math.min(Math.floor(asked), MAX_RECURRING_WEEKS)
      : RECURRING_WEEKS
    for (let week = 0; week < weeks; week++) {
      const d = new Date(act.date + 'T12:00:00')
      d.setDate(d.getDate() + week * 7)
      result.push({ ...act, date: d.toISOString().split('T')[0], recurring: true, groupId })
    }
  })
  return result
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    // Verificar limite de IA do plano
    const plan = await getFamilyPlan()
    const aiLimit = PLAN_LIMITS[plan].aiPerMonth
    if (aiLimit !== Infinity) {
      const used = await getAiUsageThisMonth(user.id)
      if (used >= aiLimit) {
        return NextResponse.json(
          { error: 'LIMIT_AI', plan, used, limit: aiLimit },
          { status: 402 }
        )
      }
    }

    const formData = await req.formData()
    const text = formData.get('text') as string | null
    const file = formData.get('image') as File | null

    if (!text && !file) return NextResponse.json({ error: 'Envie texto ou imagem' }, { status: 400 })
    if (text && text.length > MAX_TEXT_CHARS) {
      return NextResponse.json({ error: 'Texto muito longo (máx. 12 mil caracteres)' }, { status: 400 })
    }
    if (file && file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Imagem muito grande (máx. 8 MB)' }, { status: 400 })
    }

    let message
    let normalized: Awaited<ReturnType<typeof normalizeImage>> = null

    if (file) {
      const bytes = await file.arrayBuffer()
      normalized = await normalizeImage(Buffer.from(bytes), file.type, file.name)
      if (!normalized) {
        return NextResponse.json({ error: 'Formato não suportado (use JPG, PNG, GIF, WebP ou foto da câmera)' }, { status: 400 })
      }
    }

    if (normalized) {
      const base64 = normalized.buffer.toString('base64')
      const mediaType = normalized.mediaType
      const imageBlock = { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: base64 } }

      // Checagem rápida e barata (Haiku, sem thinking) só para decidir o
      // modelo da extração de verdade — grades de horário são tabelas densas
      // onde o Haiku sozinho tende a pular células; Sonnet é bem mais
      // meticuloso, mas mais caro, então só usamos quando vale a pena.
      const detect = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{
          role: 'user',
          content: [
            imageBlock,
            { type: 'text', text: 'Esta imagem é uma tabela/grade de horários semanais (colunas por dia da semana, linhas por período de aula)? Responda apenas "sim" ou "não".' },
          ],
        }],
      })
      const detectText = detect.content.find(b => b.type === 'text')
      const isScheduleGrid = detectText?.type === 'text' && /sim/i.test(detectText.text)

      message = await client.messages.create({
        model: isScheduleGrid ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
        max_tokens: 12000,
        // Só ativa thinking quando usamos Sonnet numa grade densa — reforça
        // a conferência célula-a-célula; capturas simples ficam rápidas.
        ...(isScheduleGrid ? { thinking: { type: 'enabled' as const, budget_tokens: 4000 } } : {}),
        messages: [{
          role: 'user',
          content: [imageBlock, { type: 'text', text: buildPrompt() }],
        }],
      })
    } else {
      message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `Conteúdo para analisar:\n\n${text}\n\n${buildPrompt()}`,
        }],
      })
    }

    const textBlock = message.content.find(b => b.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text.trim() : ''
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(jsonStr)

    // Registrar uso de IA (não bloqueia a resposta se falhar)
    incrementAiUsage(user.id).catch(err => console.error('[ai-extract] incrementAiUsage error', err))

    // Só a entrada de texto passa pela trava de recorrência — nela temos a
    // fonte original para conferir. Em imagem, o texto está dentro da foto
    // (uma grade de horário é recorrente de verdade), então mantemos a IA.
    let activities: ExtractedActivity[] = parsed.activities ?? []
    if (!normalized && !RECURRENCE_RE.test(text ?? '')) {
      activities = stripFabricatedRecurrence(activities)
    }

    return NextResponse.json({
      activities: expandRecurring(activities),
      reminders: parsed.reminders ?? [],
      documents: parsed.documents ?? [],
      payments: sanitizePayments(parsed.payments),
    })
  } catch (e) {
    console.error('AI extract error:', e)
    return NextResponse.json({ error: 'Não foi possível processar. Tente novamente.' }, { status: 500 })
  }
}
