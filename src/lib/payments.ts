// Mensalidades — compromissos financeiros recorrentes (natação, piano,
// pedagoga…). A REGRA fica em `payments`; só o que já foi pago vira linha em
// `payment_marks`. As ocorrências mensais são calculadas aqui.

export interface Payment {
  id: string
  user_id: string
  family_id: string | null
  child_id: string | null
  title: string
  amount: number | null
  due_day: number
  notes: string | null
  active: boolean
  ai_generated: boolean
  created_at: string
  child?: { name: string; avatar_color: string } | null
}

export interface PaymentMark {
  id: string
  payment_id: string
  competencia: string   // 'YYYY-MM'
  paid_at: string
}

const TZ = 'America/Sao_Paulo'

/** Data de hoje no fuso de São Paulo, em 'YYYY-MM-DD'. */
export function hojeDs(): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TZ }).format(new Date())
}

/** Competência atual ('YYYY-MM'), derivada da data local. */
export function competenciaAtual(): string {
  return hojeDs().slice(0, 7)
}

export function competenciaAnterior(comp: string): string {
  const [y, m] = comp.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function competenciaSeguinte(comp: string): string {
  const [y, m] = comp.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/**
 * Data de vencimento de uma competência, em 'YYYY-MM-DD'.
 *
 * `due_day` 31 numa competência de fevereiro vira o dia 28 (ou 29): a regra
 * guardada é "todo dia 31", e o mês curto é resolvido aqui, no cálculo — não
 * na gravação, que perderia a intenção original.
 */
export function vencimentoDe(competencia: string, dueDay: number): string {
  const [y, m] = competencia.split('-').map(Number)
  const ultimoDia = new Date(y, m, 0).getDate()   // dia 0 do mês seguinte
  const dia = Math.min(dueDay, ultimoDia)
  return `${competencia}-${String(dia).padStart(2, '0')}`
}

/**
 * Primeiro vencimento de uma mensalidade: o primeiro a partir do cadastro.
 * Sem isso, cadastrar no dia 30 algo que vence todo dia 9 aparecia como
 * "venceu há 21 dias" — um atraso que nunca existiu.
 */
export function primeiroVencimento(dueDay: number, createdAt: string): string {
  const criado = new Intl.DateTimeFormat('fr-CA', { timeZone: TZ }).format(new Date(createdAt))
  const comp = criado.slice(0, 7)
  const venc = vencimentoDe(comp, dueDay)
  return venc >= criado ? venc : vencimentoDe(competenciaSeguinte(comp), dueDay)
}

// Meses anteriores a este não contam como atraso: até 30/10/2026 o atraso sumia
// na virada do mês, então ninguém tinha motivo para marcar os meses passados.
const INICIO_ATRASOS = '2026-10'

/**
 * Tudo o que está em aberto até hoje: o que vence hoje e o que atrasou, de
 * qualquer mês — o atraso só some quando o mês é marcado como pago. Do mais
 * antigo para o mais novo.
 */
export function ocorrenciasEmAberto<P extends { id: string; due_day: number; created_at: string }>(
  payments: P[],
  marks: { payment_id: string; competencia: string }[],
  hoje = hojeDs(),
): { payment: P; competencia: string; vencimento: string }[] {
  const pagos = new Set(marks.map(m => `${m.payment_id}|${m.competencia}`))
  const atual = hoje.slice(0, 7)
  const abertas: { payment: P; competencia: string; vencimento: string }[] = []

  for (const payment of payments) {
    const primeiro = primeiroVencimento(payment.due_day, payment.created_at)
    let comp = primeiro.slice(0, 7) > INICIO_ATRASOS ? primeiro.slice(0, 7) : INICIO_ATRASOS
    for (; comp <= atual; comp = competenciaSeguinte(comp)) {
      const vencimento = vencimentoDe(comp, payment.due_day)
      if (vencimento < primeiro || vencimento > hoje) continue
      if (!pagos.has(`${payment.id}|${comp}`)) abertas.push({ payment, competencia: comp, vencimento })
    }
  }
  return abertas.sort((a, b) => a.vencimento.localeCompare(b.vencimento))
}

export type PaymentStatus = 'pago' | 'vence_hoje' | 'vencido' | 'a_vencer'

/**
 * Alerta só a partir do vencimento — decisão de produto: avisar antes não
 * muda o comportamento (um PIX se resolve no dia), e gasta atenção. Mas
 * `vencido` persiste enquanto não for pago: se a pessoa não abrir o app no
 * dia exato, o aviso não pode simplesmente desaparecer.
 */
export function paymentStatus(vencimento: string, pago: boolean, hoje = hojeDs()): PaymentStatus {
  if (pago) return 'pago'
  if (vencimento === hoje) return 'vence_hoje'
  return vencimento < hoje ? 'vencido' : 'a_vencer'
}

/** Dias de atraso (>0) — só faz sentido para status 'vencido'. */
export function diasDeAtraso(vencimento: string, hoje = hojeDs()): number {
  const a = new Date(vencimento + 'T12:00:00').getTime()
  const b = new Date(hoje + 'T12:00:00').getTime()
  return Math.round((b - a) / 86_400_000)
}

export function formatBRL(valor: number | null): string {
  if (valor === null || valor === undefined) return '—'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const MESES = ['janeiro','fevereiro','março','abril','maio','junho',
               'julho','agosto','setembro','outubro','novembro','dezembro']

export function competenciaLabel(comp: string): string {
  const [y, m] = comp.split('-').map(Number)
  return `${MESES[m - 1]} de ${y}`
}

export interface PaymentOccurrence {
  payment: Payment
  competencia: string
  vencimento: string
  pago: boolean
  paidAt: string | null
  status: PaymentStatus
}

/**
 * Monta as ocorrências de uma competência a partir das regras ativas e das
 * marcas já gravadas. Ordena por urgência: vencido, vence hoje, a vencer,
 * pago — e, dentro de cada grupo, pelo vencimento.
 */
export function montarOcorrencias(
  payments: Payment[],
  marks: PaymentMark[],
  competencia: string,
  hoje = hojeDs(),
): PaymentOccurrence[] {
  const pagos = new Map(
    marks.filter(m => m.competencia === competencia).map(m => [m.payment_id, m.paid_at]),
  )
  const ORDEM: Record<PaymentStatus, number> = { vencido: 0, vence_hoje: 1, a_vencer: 2, pago: 3 }

  return payments
    .filter(p => p.active)
    // Antes do primeiro vencimento a mensalidade ainda não existia.
    .filter(p => vencimentoDe(competencia, p.due_day) >= primeiroVencimento(p.due_day, p.created_at))
    .map(p => {
      const vencimento = vencimentoDe(competencia, p.due_day)
      const paidAt = pagos.get(p.id) ?? null
      return {
        payment: p,
        competencia,
        vencimento,
        pago: paidAt !== null,
        paidAt,
        status: paymentStatus(vencimento, paidAt !== null, hoje),
      }
    })
    .sort((a, b) =>
      ORDEM[a.status] - ORDEM[b.status] || a.vencimento.localeCompare(b.vencimento))
}
