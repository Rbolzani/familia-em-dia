import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, getAiUsageThisMonth, incrementAiUsage, PLAN_LIMITS, consumirChamadaIa, mensagemLimiteDiario } from '@/lib/billing'
import { normalizeImage } from '@/lib/image'
import { extrairComGemini, geminiConfigurado } from '@/lib/ia-gemini'
import { aplicarTravasDeAtividade, semCamposInternos, semDocumentoDeGrade, type ExtractedActivity } from '@/lib/ia-pos-processamento'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Grade de horário densa, com thinking, leva 52–59s. O teto de 60s era do
// plano Hobby e deixava ~1s de folga (achado 15); no Pro o limite é 300s.
export const maxDuration = 300

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

⚠️ REGRA DE DATA — vale para TODA data que você gerar, e vem antes de tudo:
- "dia 12" (só o dia, sem mês em lugar nenhum do conteúdo): se o 12 já passou
  neste mês, é o **dia 12 do MÊS QUE VEM**. Se ainda não chegou, é deste mês.
  Se é hoje, é hoje.
- Dia e mês escritos, sem ano ("15 de agosto", "19/08", ou os dias de um
  calendário com o título "Outubro"): use o mês escrito e o **ano atual**,
  MESMO QUE A DATA JÁ TENHA PASSADO. Se o dia da semana estiver escrito junto
  ("19/08 (quarta)"), use o ano em que o dia da semana e a data coincidem.
  Não avance para outro mês nem outro ano: o app confere cada data depois e
  avisa a pessoa quando o evento já passou.
- **Inclua TODOS os eventos que você ler**, inclusive os que já passaram.
  Nunca deixe um evento de fora por causa da data.
- data completa com ano: respeite como está.

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
- weekday: o dia da semana da COLUNA da célula ("seg", "ter", "qua", "qui", "sex", "sab" ou "dom") — obrigatório em grade
- recurring: true (marca que esse item se repete toda semana no mesmo dia/horário)
- Gere um item para CADA célula preenchida da grade, mesmo que o total seja alto (dezenas de itens) — nunca resuma, agrupe ou pule células.
- Inclua TAMBÉM as células de intervalo/refeição (ex: "Lanche/Recreio", "Almoço/Recreio", "Lanche/Saída") e as linhas de entrada e saída como itens normais: a grade deve sair completa, sem filtrar nada.
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

⚠️ **PARA SER payment, PRECISA DAS TRÊS COISAS AO MESMO TEMPO:**
1. **um VALOR em dinheiro** — "R$ 280", "250 reais", "1.600 por mês.
   Sem valor explícito, NÃO é payment. Nunca.
2. **uma palavra de PAGAMENTO** — pagar, pago, pagamento, transferir,
   transferência, PIX, mensalidade, cobrança, boleto, vence, custa.
   Sem nenhuma delas, NÃO é payment. Nunca.
3. **um DIA DO MÊS** em que a cobrança cai — "todo dia 10", "vence dia 5".

Faltando QUALQUER uma das três, o item **não é payment**.

⚠️ **Valor sozinho NÃO basta.** Preço mencionado de passagem continua sendo
compromisso, não cobrança:
- "psicopedagoga todas as segundas às 17h, **R$ 400 a sessão**" ⇒ **activity**
  (saude, recorrente). Tem valor, mas não diz que alguém PAGA em algum DIA DO
  MÊS — é o preço da sessão, informação solta. O compromisso é o que importa.
- "natação terças e quintas, **mensalidade R$ 280 no dia 10**" ⇒ aí sim tem
  as três: valor, "mensalidade", dia 10.
Se a frase descreve QUANDO ALGO ACONTECE e o dinheiro aparece só como preço,
é **activity**. O valor entra na descrição, não cria uma cobrança.

⚠️ **O nome da profissão ou da atividade NÃO decide nada.** "Psicopedagoga",
"fonoaudióloga", "natação" e "piano" aparecem dos dois lados. O que decide é
se a frase fala de DINHEIRO e de PAGAR:
- "psicopedagoga todas as segundas às 17h" ⇒ **activity** recorrente.
  Não há valor nem verbo de pagamento — é quando o compromisso ACONTECE.
- "psicopedagoga, R$ 1.600, pago todo dia 15" ⇒ **payment**.
  Tem valor, tem "pago", tem dia do mês.

⚠️ **RECORRÊNCIA NÃO MUDA A CATEGORIA.** "Toda segunda" apenas liga
"recurring": true — a escolha entre escola / saude / extracurricular segue
EXATAMENTE os mesmos critérios de um compromisso de data única:
- terapia, consulta, acompanhamento profissional de saúde (psicopedagoga,
  fonoaudióloga, psicóloga, fisioterapeuta) → **saude**
- algo ligado à escola → **escola**
- esporte, curso, música, hobby e todo o resto → **extracurricular**
Na dúvida entre activity e payment, escolha **activity**: um compromisso na
agenda errada a pessoa move; um item que some, ela perde.

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
      "recurring_weeks": null,
      "weekday": "seg, ter, qua, qui, sex, sab, dom ou null",
      "month_written": false
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
- category: exatamente "escola", "saude" ou "extracurricular" — mesma regra das
  activities, inclusive o desempate: "escola" só com vínculo escolar explícito,
  e "extracurricular" como padrão na dúvida
- escola: material pedido pela escola, reuniões sem data, pendências da escola
- saude: renovar plano de saúde, agendar consulta, buscar receita
- extracurricular: inscrições, renovações, e qualquer pendência que não seja
  escolar nem de saúde (comprar presente, confirmar presença numa festa)

Regras para activities:
- category: exatamente "escola", "saude" ou "extracurricular"

- **escola** — SOMENTE o que tem vínculo com a escola: prova, trabalho, lição,
  reunião de pais, evento promovido pela escola, entrega de material pedido pela
  escola, passeio organizado pela escola.
  ⚠️ Se a ESCOLA não estiver envolvida, NÃO é "escola" — mesmo que envolva uma
  criança, mesmo que envolva outras crianças, mesmo que aconteça em dia de
  semana. Festa de aniversário de coleguinha NÃO é escola. Aniversário de
  criança NÃO é escola. Idade de criança ("8 anos") não indica escola.

- **saude** — consulta, exame, vacina, retorno, terapia, dentista.

- **extracurricular** — é a categoria PADRÃO e aparece para a pessoa apenas como
  "Atividades". Cobre duas coisas:
  (a) atividades regulares: esportes, cursos, música, hobbies, competições;
  (b) TUDO o que não for escola nem saúde: festa de aniversário, passeio, viagem,
      visita, evento de família, casamento, combinado de fim de semana, troca de
      guarda ("fim de semana com a mamãe"), compromisso pessoal.

- ⚠️ REGRA DE DESEMPATE: na dúvida entre as três, use "extracurricular".
  NUNCA escolha "escola" por eliminação — "escola" precisa de vínculo escolar
  explícito no conteúdo. Colocar um compromisso pessoal na agenda escolar
  atrapalha mais do que deixá-lo na aba genérica.
- date: calcule datas relativas a partir de hoje se necessário; null se incerta

- **Datas sem ano** (quase nunca o conteúdo traz o ano):
  · **Só o dia do mês** ("dia 12", "no dia 5"), sem mês em lugar nenhum — se
    esse dia ainda não chegou neste mês, use este mês; se **já passou**, use o
    **MÊS SEGUINTE**. Exemplo: hoje é ${todayISO}; "dia 12" ⇒ dia 12 do mês que
    vem, porque o 12 deste mês ficou para trás. Se for hoje, é hoje.
  · **O mês está escrito** (calendário com título "Outubro", "15 de agosto",
    "19/08"): use ESSE mês e o **ano atual**, mesmo que a data já tenha
    passado. Não empurre para outro mês nem outro ano, e não deixe o evento
    de fora: o app confere a data e avisa a pessoa (marque month_written).
  · **Dia da semana escrito junto da data** ("19/08 (quarta)"): o ano certo é
    aquele em que o dia da semana e a data coincidem; preencha weekday.
  · **Data completa com ano** — respeite exatamente o que está escrito.
- recurring: true SOMENTE se o conteúdo expressar recorrência explícita
  ("toda terça", "às segundas", "semanalmente") ou for uma grade de horário
  escolar. Rotina implícita ou hábito não é recorrência — se o conteúdo não
  disser a frequência com essas palavras, use recurring: false.
- recurring_weeks: por quantas SEMANAS a recorrência deve valer, quando o
  conteúdo disser um limite. Converta o que o usuário falou para semanas:
  "por 4 semanas" → 4 · "durante 2 meses" → 8 · "até o fim do mês" → conte as
  semanas a partir de hoje · "3 vezes" → 3. Se o conteúdo NÃO indicar limite
  algum (incluindo grades de horário escolar), use null.
- weekday: o dia da semana ESCRITO no conteúdo para o item — a coluna da
  grade, "toda terça", "19/08 (quarta)". Use null se o dia da semana não
  estiver escrito: não deduza a partir da data.
- month_written: true se o conteúdo escreve o mês dessa data (nome do mês,
  "19/08", ou o título do calendário); false se diz só o dia ("dia 12") ou
  uma data relativa ("amanhã", "sexta que vem").
- Se o conteúdo pede uma AÇÃO da família sem data própria (agendar horário,
  confirmar presença, levar dinheiro ou material, enviar autorização), crie
  também um reminder com essa ação.

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
function sanitizePayments(raw: unknown): { pagamentos: ExtractedPayment[]; descartados: string[] } {
  const descartados: string[] = []
  if (!Array.isArray(raw)) return { pagamentos: [], descartados }
  const out: ExtractedPayment[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 80) : ''
    if (!title) continue

    const dia = Number(o.due_day)
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      // Descartado aqui, o item SOME — e some calado, que é o pior desfecho:
      // a pessoa digitou algo, a análise "funcionou", e não apareceu nada.
      // Foi exatamente o que aconteceu com "psicopedagoga todas as segundas
      // às 17h": a IA chamou de mensalidade (pelo nome da profissão), sem dia
      // do mês, e o item evaporou. Guardamos para virar lembrete.
      descartados.push(title)
      continue
    }

    let amount: number | null = null
    if (typeof o.amount === 'number' && Number.isFinite(o.amount)) {
      amount = o.amount
    } else if (typeof o.amount === 'string') {
      const n = Number(o.amount.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
      amount = Number.isFinite(n) ? n : null
    }
    if (amount !== null && (amount < 0 || amount > 1_000_000)) amount = null

    // Mensalidade SEM VALOR não é mensalidade — regra do produto, e a trava
    // fica aqui porque o prompt sozinho não garante.
    //
    // Sem o valor, o item é quase sempre um compromisso recorrente que a IA
    // leu como cobrança pelo nome da profissão ("psicopedagoga toda segunda").
    // Mandar para lembrete devolve a decisão à pessoa; deixar passar criaria
    // uma cobrança fantasma de R$ 0 no módulo de dinheiro.
    if (amount === null || amount <= 0) {
      descartados.push(title)
      continue
    }

    out.push({
      title,
      amount,
      due_day: dia,
      notes: typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null,
      child_hint: typeof o.child_hint === 'string' && o.child_hint.trim() ? o.child_hint.trim() : null,
    })
  }
  return { pagamentos: out, descartados }
}

// Horizonte PADRÃO de materialização (recurring: true) — a tabela activities
// não tem conceito de recorrência, então cada ocorrência semanal vira uma
// linha própria. Vale só quando o conteúdo não define um limite: "toda terça
// por 4 semanas" respeita as 4 (recurring_weeks); grade de horário escolar,
// que não tem condição de contorno, usa este padrão.
const RECURRING_WEEKS = 12
const MAX_RECURRING_WEEKS = 52

// A grade de horários entra INTEIRA, sem filtro: lanche, almoço, recreio,
// soninho, entrada, saída. Decisão do Rogério (11/10/2026). Já houve aqui um
// filtro de intervalo/refeição e depois um só de entrada/saída; qualquer corte
// gerava incoerência (Almoço fora e Jantar dentro, Saída fora e Entrada
// dentro) e trata diferente o maternal, onde isso é a rotina de verdade.
// Quem não quiser um item desmarca na revisão, antes de salvar.

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

// Sinal de vida. A análise de uma grade densa leva minutos, e nesse tempo a
// resposta não trafegava um byte: a conexão do celular caía e a tela mostrava
// "Failed to fetch", embora o servidor concluísse com 200 (visto em produção
// em 09/10/2026: 7 tentativas, 7 respostas 200, 1 entregue).
//
// O que responde rápido (sem sessão, limite do plano, arquivo inválido) sai
// como sempre, com o status HTTP certo. Só quando a análise passa de alguns
// segundos a resposta vira um fluxo: espaços em branco a cada poucos segundos
// e, no fim, o JSON de sempre com o status real em `_status` (o HTTP já foi
// enviado como 200). Espaço antes do JSON não atrapalha o `res.json()`.
const ESPERA_ANTES_DO_FLUXO_MS = 3000
const INTERVALO_SINAL_MS = 5000

export async function POST(req: NextRequest) {
  const trabalho = processar(req)
  const rapido = await Promise.race([
    trabalho,
    new Promise<null>(ok => setTimeout(() => ok(null), ESPERA_ANTES_DO_FLUXO_MS)),
  ])
  if (rapido) return rapido

  const enc = new TextEncoder()
  const sinal = enc.encode(' '.repeat(256) + '\n')
  const fluxo = new ReadableStream<Uint8Array>({
    async start(controle) {
      controle.enqueue(sinal)
      const relogio = setInterval(() => { try { controle.enqueue(sinal) } catch { /* fluxo já fechado */ } }, INTERVALO_SINAL_MS)
      try {
        const res = await trabalho
        const corpo = await res.json()
        controle.enqueue(enc.encode(JSON.stringify({ ...corpo, _status: res.status })))
      } catch (e) {
        console.error('AI extract stream error:', e)
        controle.enqueue(enc.encode(JSON.stringify({ error: 'Não foi possível processar. Tente novamente.', _status: 500 })))
      } finally {
        clearInterval(relogio)
        try { controle.close() } catch { /* já fechado pelo cliente */ }
      }
    },
  })
  return new Response(fluxo, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

// Resposta da IA, antes das travas — o formato pedido no prompt.
interface RespostaIa {
  activities?: ExtractedActivity[]
  reminders?: { title: string; category: string; description: string | null; child_hint: string | null }[]
  documents?: { category?: string }[]
  payments?: unknown
}

function limparJson(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
}

// Reserva: a leitura como era antes do Gemini (22/10/2026). Entra quando o
// Gemini falha ou não está configurado.
async function extrairComClaude(
  normalized: Awaited<ReturnType<typeof normalizeImage>>,
  text: string | null,
  prompt: string,
): Promise<string> {
  let message
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
      //
      // ⚠️ NÃO DESLIGUE ISTO PARA GANHAR TEMPO. A tentação é real: com
      // thinking a chamada leva 52–59s contra um maxDuration de 60s, e
      // medições mostram ~19s de folga ao desativar. Eu cheguei a propor a
      // troca; está errada.
      //
      // O thinking entrou porque, com FOTO de grade real, a extração vinha
      // incompleta e — pior — com uma contagem DIFERENTE a cada captura.
      // Instabilidade, não só falta: sem isso não dá para confiar em nenhuma
      // leitura, porque não há como saber qual das contagens é a certa.
      //
      // A medição que sugeria remover usava uma grade SINTÉTICA (renderizada,
      // nítida, alinhada) — o caso fácil. Ela não fala nada sobre foto torta,
      // com sombra e contraste ruim, que é exatamente onde a conferência
      // célula-a-célula vale. Sinal na mesma direção: nessa grade perfeita, o
      // Haiku sem thinking devolveu 52 itens numa tabela de 50 — inventou duas
      // aulas no caso mais fácil possível.
      //
      // O aperto de tempo é real, mas é problema de PLATAFORMA, não de modelo:
      // 60s era o teto do plano Hobby da Vercel. O Pro levou para 300s e resolveu
      // sem tocar na qualidade. Ver achado 15 do painel de prontidão.
      ...(isScheduleGrid ? { thinking: { type: 'enabled' as const, budget_tokens: 4000 } } : {}),
      messages: [{
        role: 'user',
        content: [imageBlock, { type: 'text', text: prompt }],
      }],
    })
  } else {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Conteúdo para analisar:\n\n${text}\n\n${prompt}`,
      }],
    })
  }

  const textBlock = message.content.find(b => b.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}

async function processar(req: NextRequest): Promise<NextResponse> {
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

    // Teto diário (achado O3). O limite acima é MENSAL e por plano — no pago
    // é Infinity, então esta rota ficava sem teto algum, e cada chamada gasta
    // token na IA (Gemini, ou Anthropic na reserva).
    const cota = await consumirChamadaIa(user.id)
    if (!cota.permitido) {
      return NextResponse.json({ error: mensagemLimiteDiario(cota) }, { status: 429 })
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

    let normalized: Awaited<ReturnType<typeof normalizeImage>> = null

    if (file) {
      const bytes = await file.arrayBuffer()
      normalized = await normalizeImage(Buffer.from(bytes), file.type, file.name)
      if (!normalized) {
        return NextResponse.json({ error: 'Formato não suportado (use JPG, PNG, GIF, WebP ou foto da câmera)' }, { status: 400 })
      }
    }

    // Gemini primeiro; qualquer falha (erro, demora, JSON inválido) cai no
    // Claude, que segue igual ao que era antes da troca. Sem GEMINI_API_KEY
    // configurada, vai direto para o Claude.
    const prompt = buildPrompt()
    let parsed: RespostaIa | null = null
    if (geminiConfigurado()) {
      try {
        const raw = await extrairComGemini({
          prompt,
          imagem: normalized ? { base64: normalized.buffer.toString('base64'), mediaType: normalized.mediaType } : undefined,
          texto: text ?? undefined,
        })
        parsed = JSON.parse(limparJson(raw))
      } catch (e) {
        console.warn('[ai-extract] Gemini falhou, usando o Claude:', e instanceof Error ? e.message : e)
      }
    }
    if (!parsed) parsed = JSON.parse(limparJson(await extrairComClaude(normalized, text, prompt))) as RespostaIa

    // Registrar uso de IA (não bloqueia a resposta se falhar)
    incrementAiUsage(user.id).catch(err => console.error('[ai-extract] incrementAiUsage error', err))

    // Só a entrada de texto passa pela trava de recorrência — nela temos a
    // fonte original para conferir. Em imagem, o texto está dentro da foto
    // (uma grade de horário é recorrente de verdade), então mantemos a IA.
    let activities: ExtractedActivity[] = parsed.activities ?? []
    if (!normalized && !RECURRENCE_RE.test(text ?? '')) {
      activities = stripFabricatedRecurrence(activities)
    }
    // Travas determinísticas de título e data (lib/ia-pos-processamento.ts):
    // as regras existem no prompt, mas erram em parte das vezes. Aqui não erram.
    const travas = aplicarTravasDeAtividade(activities, spTodayISO(), normalized ? null : (text ?? null))
    activities = travas.activities

    // Mensalidade sem dia do mês não vira mensalidade — mas também não pode
    // sumir. Volta como lembrete, para a pessoa decidir o que fazer com ela.
    const { pagamentos, descartados } = sanitizePayments(parsed.payments)
    const lembretes = [...(parsed.reminders ?? [])]
    for (const titulo of descartados) {
      lembretes.push({
        title: titulo,
        category: 'extracurricular',
        description: 'A IA entendeu como mensalidade, mas faltou o valor ou o dia do vencimento. Se for uma cobrança, cadastre em Mensalidades; se for um compromisso, mova para a agenda.',
        child_hint: null,
      })
    }
    if (descartados.length > 0) {
      console.warn('[ai-extract] pagamentos sem dia do mês viraram lembrete:', descartados.join(', '))
    }

    return NextResponse.json({
      activities: expandRecurring(activities).map(semCamposInternos),
      reminders: lembretes,
      documents: semDocumentoDeGrade(activities, parsed.documents ?? []),
      payments: pagamentos,
      // Eventos que já aconteceram: fora da agenda, mas a tela avisa e oferece
      // "Incluir mesmo assim" (lib/ia-pos-processamento.ts).
      past_activities: travas.descartadas.map(semCamposInternos),
    })
  } catch (e) {
    console.error('AI extract error:', e)
    return NextResponse.json({ error: 'Não foi possível processar. Tente novamente.' }, { status: 500 })
  }
}
