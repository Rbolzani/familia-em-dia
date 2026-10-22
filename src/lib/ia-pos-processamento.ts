// Travas determinísticas aplicadas à resposta da IA de captura (/api/ai-extract),
// DEPOIS do reconhecimento e ANTES de mostrar a revisão. Valem para qualquer
// modelo: o prompt pede, mas pedido não é garantia — onde existe uma checagem
// barata e determinística, ela fica aqui.
//
// Sem imports de propósito: o teste comparativo de modelos (testes-ia/testar.mjs,
// fora do app) importa este arquivo direto pelo Node, para avaliar cada modelo
// com exatamente as mesmas travas que rodam em produção.

export interface ExtractedActivity {
  title: string
  category: string
  date: string | null
  time: string | null
  description?: string | null
  location?: string | null
  recurring?: boolean
  recurring_weeks?: number | null
  groupId?: string
  /** Dia da semana ESCRITO no conteúdo para o item: coluna da grade, "toda terça", "19/08 (quarta)". */
  weekday?: string | null
  /** O conteúdo escreve o mês da data ("15 de agosto", "19/08", calendário com título "Outubro"). */
  month_written?: boolean | null
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const

/** "Segunda-feira", "seg", "SÁB." → índice 0–6 (domingo = 0); null se não reconhecer. */
export function indiceDiaSemana(valor: unknown): number | null {
  if (typeof valor !== 'string') return null
  const v = valor.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().slice(0, 3)
  const i = DIAS.indexOf(v as (typeof DIAS)[number])
  return i >= 0 ? i : null
}

const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const ehISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Ano escrito na fonte ("12/03/2027", "março de 2027"). */
const ANO_EXPLICITO_RE = /\b20\d{2}\b/

/**
 * "Lanche - Segunda-feira" → "Lanche". Em grade, alguns modelos repetem o dia
 * no título; o dia já está na data, e o título fica poluído na agenda.
 */
export function limparTitulos(activities: ExtractedActivity[]): ExtractedActivity[] {
  const SUFIXO = /\s*[-–—(,]\s*(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?\s*\)?\s*$/i
  return activities.map(a => {
    if (!a.recurring || typeof a.title !== 'string') return a
    const limpo = a.title.replace(SUFIXO, '').trim()
    return limpo && limpo !== a.title ? { ...a, title: limpo } : a
  })
}

/**
 * Recorrente com dia da semana → a data é calculada aqui, não pela IA.
 *
 * POR QUE: medido em 22/10/2026 (testes-ia/), com a grade em mãos todos os
 * modelos erraram a conta de data em alguma rodada — a quinta-feira caindo na
 * sexta, a semana inteira numa data só, a segunda num sábado. Ler o dia da
 * coluna eles acertam; transformar isso em data é aritmética, e aritmética é
 * trabalho do código. A data vira a próxima ocorrência daquele dia, a partir
 * de hoje (inclusive).
 */
export function datasPorDiaDaSemana(activities: ExtractedActivity[], hojeISO: string): ExtractedActivity[] {
  const hoje = utc(hojeISO)
  return activities.map(a => {
    if (!a.recurring) return a
    const alvo = indiceDiaSemana(a.weekday)
    if (alvo === null) return a
    const d = new Date(hoje)
    d.setUTCDate(d.getUTCDate() + ((alvo - d.getUTCDay() + 7) % 7))
    return { ...a, date: iso(d) }
  })
}

/**
 * Data única com o dia da semana escrito ao lado ("19/08 (quarta)"): o ano
 * certo é aquele em que dia e data coincidem — é a pista mais forte que o
 * conteúdo dá sobre o ano. Se a IA escolheu um ano em que não coincidem, troca
 * pelo ano vizinho em que coincidem (o mais próximo de hoje).
 */
export function anoPeloDiaDaSemana(activities: ExtractedActivity[], hojeISO: string): ExtractedActivity[] {
  const anoHoje = Number(hojeISO.slice(0, 4))
  return activities.map(a => {
    if (a.recurring || !ehISO(a.date)) return a
    const alvo = indiceDiaSemana(a.weekday)
    if (alvo === null || utc(a.date).getUTCDay() === alvo) return a
    const mmdd = a.date.slice(4)
    for (const ano of [anoHoje, anoHoje - 1, anoHoje + 1]) {
      const cand = `${ano}${mmdd}`
      if (ehISO(cand) && iso(utc(cand)) === cand && utc(cand).getUTCDay() === alvo) return { ...a, date: cand }
    }
    return a
  })
}

/**
 * Data no passado → próxima ocorrência; ou, quando o evento já aconteceu, sai.
 *
 * POR QUE EM CÓDIGO, E NÃO NO PROMPT
 * A regra existe no prompt e funciona — na maior parte das vezes. Medido com
 * a frase que o Rogério usou ("Viagem com a Gabi no dia 11 às 7h", em 14/09):
 * três execuções devolveram 11/10, 11/10 e **11/09**. Uma em três no passado.
 * O estrago é silencioso: a atividade é gravada, aparece no calendário, mas
 * some da aba (que esconde o passado). Parece que a captura não salvou nada.
 *
 * REGRAS — espelham as do prompt, de propósito:
 *  · recorrente     → avança de 7 em 7 dias, preservando o dia da SEMANA
 *  · MÊS ESCRITO e passou há até 45 dias → o evento JÁ ACONTECEU: sai da lista.
 *    (Calendário de "Outubro" fotografado no dia 22: o feriado do dia 12 não
 *    é "12 de novembro" — antes desta regra ia parar lá. Medido em 22/10/2026.)
 *  · DIA DA SEMANA ESCRITO e a data que coincide já passou → também sai: o dia
 *    da semana fixa o ano, e "19/08 (quarta)" no ano seguinte cairia numa quinta.
 *  · só o dia, sem mês ("dia 11"), passado recente → mesmo dia do mês seguinte
 *  · passado distante → mesma data do ano seguinte (a pessoa disse dia e mês)
 *  · ano escrito na fonte → não mexe, ali ela foi explícita
 */
export function corrigirDatasPassadas(
  activities: ExtractedActivity[],
  hojeISO: string,
  textoOriginal: string | null,
): { activities: ExtractedActivity[]; descartadas: string[] } {
  // Na entrada por imagem não há fonte para inspecionar; a trava vale assim
  // mesmo, porque atividade é compromisso FUTURO por definição.
  if (textoOriginal && ANO_EXPLICITO_RE.test(textoOriginal)) return { activities, descartadas: [] }

  const hojeDt = utc(hojeISO)
  const corrigidas: string[] = []
  const descartadas: string[] = []
  const saida: ExtractedActivity[] = []

  for (const a of activities) {
    if (!ehISO(a.date) || a.date >= hojeISO) { saida.push(a); continue }
    const [y, m, d] = a.date.split('-').map(Number)
    const dt = utc(a.date)
    const diasAtras = (hojeDt.getTime() - dt.getTime()) / 86_400_000
    let nova: string

    if (a.recurring) {
      // Semana a semana: avançar um mês moveria o dia da SEMANA e quebraria
      // a grade de horário.
      while (dt < hojeDt) dt.setUTCDate(dt.getUTCDate() + 7)
      nova = iso(dt)
    } else if (indiceDiaSemana(a.weekday) === dt.getUTCDay() || (a.month_written === true && diasAtras <= 45)) {
      descartadas.push(`${a.title} (${a.date})`)
      continue
    } else if (diasAtras <= 45) {
      // Passado recente → a pessoa disse só o dia ("dia 11"). Avança de mês em
      // mês preservando o dia, encurtando em mês curto (31 → 28/30).
      //
      // A distância decide, não a igualdade de mês: em 1º de fevereiro, uma
      // data de 31 de janeiro está a UM dia de distância mas em outro mês —
      // comparar o mês jogaria isso para o ano seguinte.
      let ay = y, am = m
      do {
        am += 1
        if (am > 12) { am = 1; ay += 1 }
        const ultimo = new Date(Date.UTC(ay, am, 0)).getUTCDate()
        nova = `${ay}-${String(am).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
      } while (nova < hojeISO)
    } else {
      // Passado distante → a pessoa disse dia E mês; vale para o próximo ano
      // em que essa data ainda não passou.
      let ay = y
      do { ay += 1; nova = `${ay}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
      while (nova < hojeISO)
    }

    corrigidas.push(`${a.date}→${nova}`)
    saida.push({ ...a, date: nova })
  }

  if (corrigidas.length > 0) {
    // Sem log, não dá para saber se o prompt está melhorando ou piorando.
    console.warn('[ai-extract] datas no passado corrigidas:', corrigidas.join(', '))
  }
  if (descartadas.length > 0) {
    console.warn('[ai-extract] eventos que já aconteceram, fora da lista:', descartadas.join(', '))
  }
  return { activities: saida, descartadas }
}

/**
 * Grade de horário nunca vira documento — o prompt diz isso, e mesmo assim
 * todos os modelos testados (22/10/2026) guardavam a foto da grade no Cofre
 * como "documento escolar" a cada captura. Com uma grade no resultado (muitas
 * atividades recorrentes com dia da semana), o documento escolar sai.
 */
export function semDocumentoDeGrade<D extends { category?: string }>(
  activities: ExtractedActivity[],
  documents: D[],
): D[] {
  const ehGrade = activities.filter(a => a.recurring && indiceDiaSemana(a.weekday) !== null).length >= 10
  return ehGrade ? documents.filter(d => d.category !== 'escolar') : documents
}

/** Campos que só servem às travas acima — não vão para a tela nem para o banco. */
export function semCamposInternos(a: ExtractedActivity): ExtractedActivity {
  const resto = { ...a }
  delete resto.weekday
  delete resto.month_written
  return resto
}

/** Todas as travas de atividade, na ordem certa. */
export function aplicarTravasDeAtividade(
  activities: ExtractedActivity[],
  hojeISO: string,
  textoOriginal: string | null,
): { activities: ExtractedActivity[]; descartadas: string[] } {
  let acts = limparTitulos(activities)
  acts = datasPorDiaDaSemana(acts, hojeISO)
  acts = anoPeloDiaDaSemana(acts, hojeISO)
  return corrigirDatasPassadas(acts, hojeISO, textoOriginal)
}
