// Oferta comercial vigente (desde 16/10/2026) — FONTE ÚNICA de preços e da
// tabela comparativa. Sem dependência de servidor: a tela Planos (cliente), o
// checkout, o e-mail de fim do teste e a landing (cópia manual, ver abaixo)
// mostram exatamente estes valores.
//
//   Gratuito  R$ 0     · até 2 filhos, IA 5/mês, sem voz/WhatsApp/rede de apoio
//   Família   R$ 19,90/mês · R$ 190,80/ano (R$ 15,90/mês, −20%)
//   Plus      R$ 29,90/mês · R$ 286,80/ano (R$ 23,90/mês, −20%)
//   Teste de 14 dias do Família, sem cartão. Sem oferta de lançamento.
//
// ⚠️ Mudar preço aqui exige também: um lookup_key NOVO em PRECOS_VIGENTES
// (o Stripe não altera o valor de um preço existente) e a seção de planos da
// landing estática (public/marketing/Landing-Familia-em-Dia-P6-IA.html).
// Os limites de uso continuam em billing.ts (PLAN_LIMITS) — a tabela abaixo
// só os descreve.

export type PlanoPago = 'familia' | 'plus'
export type Ciclo = 'month' | 'year'

export const PRECOS_VIGENTES: Record<`${PlanoPago}:${Ciclo}`, { lookupKey: string; centavos: number }> = {
  'familia:month': { lookupKey: 'familia_mensal_2026_10', centavos: 1990 },
  'familia:year':  { lookupKey: 'familia_anual_2026_10',  centavos: 19080 },  // R$ 15,90/mês
  'plus:month':    { lookupKey: 'plus_mensal_2026_10',    centavos: 2990 },
  'plus:year':     { lookupKey: 'plus_anual_2026_10',     centavos: 28680 },  // R$ 23,90/mês
}

export const DESCONTO_ANUAL_PCT = 20
export const DIAS_TESTE = 14

/** Preço por mês, em reais (o anual dividido por 12). */
export function precoPorMes(plan: PlanoPago, ciclo: Ciclo): number {
  const c = PRECOS_VIGENTES[`${plan}:${ciclo}`].centavos
  return ciclo === 'year' ? c / 1200 : c / 100
}
/** Valor cobrado de uma vez, em reais (o mês, ou o ano inteiro). */
export function precoCobrado(plan: PlanoPago, ciclo: Ciclo): number {
  return PRECOS_VIGENTES[`${plan}:${ciclo}`].centavos / 100
}
export function reais(n: number): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Célula da tabela: texto, ou true/false para ✓ / —. */
export type Celula = string | boolean
export interface LinhaComparativo { recurso: string; gratuito: Celula; familia: Celula; plus: Celula }

export const COMPARATIVO: LinhaComparativo[] = [
  { recurso: 'Preço mensal', gratuito: 'Grátis', familia: reais(precoPorMes('familia', 'month')), plus: reais(precoPorMes('plus', 'month')) },
  { recurso: `No plano anual (−${DESCONTO_ANUAL_PCT}%)`, gratuito: false, familia: `${reais(precoPorMes('familia', 'year'))}/mês`, plus: `${reais(precoPorMes('plus', 'year'))}/mês` },
  { recurso: 'Filhos', gratuito: 'até 2', familia: 'até 2', plus: 'ilimitados' },
  { recurso: 'Rede de apoio (pai, avó, babá)', gratuito: false, familia: '1 pessoa', plus: 'ilimitada' },
  { recurso: 'Captura por IA (foto e texto)', gratuito: '5 por mês', familia: 'ilimitada', plus: 'ilimitada' },
  { recurso: 'Captura por voz', gratuito: false, familia: true, plus: true },
  { recurso: 'Resumo diário no WhatsApp', gratuito: false, familia: true, plus: true },
  { recurso: 'Cofre de documentos', gratuito: 'sem envio de arquivos', familia: '500 MB', plus: '5 GB' },
  { recurso: 'Agenda, logística e mensalidades', gratuito: true, familia: true, plus: true },
  { recurso: 'Suporte prioritário', gratuito: false, familia: false, plus: true },
]

/** O que deixa de funcionar quando o teste do Família acaba sem assinatura. */
export const PERDE_NO_GRATUITO = [
  'o resumo diário das atividades no WhatsApp',
  'a captura por voz',
  'a captura por IA ilimitada (passa a 5 por mês)',
  'o acesso de quem você convidou para a rede de apoio',
  'o envio de novos arquivos ao cofre de documentos',
]
/** O que continua no gratuito — para o aviso não soar como perda total. */
export const CONTINUA_NO_GRATUITO = 'Sua agenda, até 2 filhos, as mensalidades e os documentos já guardados continuam com você.'
