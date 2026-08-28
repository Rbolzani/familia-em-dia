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
