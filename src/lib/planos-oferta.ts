// Oferta comercial vigente — FONTE ÚNICA de preços, da tabela comparativa e das
// frases da oferta. Sem dependência de servidor: a tela Planos (cliente), o
// cadastro, o checkout, os e-mails e a landing (cópia manual, ver abaixo)
// mostram exatamente estes valores. Textos aprovados pelo Rogério em 20/10/2026
// (Nova-Oferta-Textos-para-aprovacao.md, T1/T2).
//
//   Básico   R$ 19,90/mês · R$ 190,80/ano (R$ 15,90/mês, −20%)
//   Família  R$ 24,90/mês · R$ 238,80/ano (R$ 19,90/mês, −20%)  ← Recomendado
//   Plus     R$ 34,90/mês · R$ 334,80/ano (R$ 27,90/mês, −20%)
//   14 dias grátis em qualquer plano, com cartão no cadastro. Sem plano gratuito
//   para contas novas (o gratuito existe só para contas do modelo antigo).
//
// ⚠️ Mudar preço aqui exige também: um lookup_key NOVO em PRECOS_VIGENTES
// (o Stripe não altera o valor de um preço existente) e a seção de planos da
// landing estática (public/marketing/Landing-Familia-em-Dia-P6-IA.html).
// Os limites de uso ficam em planos-limites.ts (PLAN_LIMITS) — a tabela abaixo
// só os descreve (o limite de reconhecimentos do Básico vem de lá).

import { PLAN_LIMITS } from '@/lib/planos-limites'

export type PlanoPago = 'basico' | 'familia' | 'plus'
export type Ciclo = 'month' | 'year'

export const PLANOS_PAGOS: PlanoPago[] = ['basico', 'familia', 'plus']
export const PLANO_RECOMENDADO: PlanoPago = 'familia'

export const NOME_PLANO: Record<PlanoPago, string> = {
  basico: 'Básico',
  familia: 'Família',
  plus: 'Plus',
}

export const PRECOS_VIGENTES: Record<`${PlanoPago}:${Ciclo}`, { lookupKey: string; centavos: number }> = {
  'basico:month':  { lookupKey: 'basico_mensal_2026_11',  centavos: 1990 },
  'basico:year':   { lookupKey: 'basico_anual_2026_11',   centavos: 19080 },  // R$ 15,90/mês
  'familia:month': { lookupKey: 'familia_mensal_2026_11', centavos: 2490 },
  'familia:year':  { lookupKey: 'familia_anual_2026_11',  centavos: 23880 },  // R$ 19,90/mês
  'plus:month':    { lookupKey: 'plus_mensal_2026_11',    centavos: 3490 },
  'plus:year':     { lookupKey: 'plus_anual_2026_11',     centavos: 33480 },  // R$ 27,90/mês
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
/** "R$ 24,90 por mês" / "R$ 238,80 por ano" — o valor de cada cobrança. */
export function valorDaCobranca(plan: PlanoPago, ciclo: Ciclo): string {
  return `${reais(precoCobrado(plan, ciclo))} por ${ciclo === 'year' ? 'ano' : 'mês'}`
}

/** Célula da tabela: texto, ou true/false para ✓ / —. */
export type Celula = string | boolean
export interface LinhaComparativo { recurso: string; basico: Celula; familia: Celula; plus: Celula }

export const COMPARATIVO: LinhaComparativo[] = [
  { recurso: 'Mensal', basico: reais(precoPorMes('basico', 'month')), familia: reais(precoPorMes('familia', 'month')), plus: reais(precoPorMes('plus', 'month')) },
  { recurso: `Anual (−${DESCONTO_ANUAL_PCT}%)`, basico: `${reais(precoPorMes('basico', 'year'))}/mês`, familia: `${reais(precoPorMes('familia', 'year'))}/mês`, plus: `${reais(precoPorMes('plus', 'year'))}/mês` },
  { recurso: 'Filhos', basico: 'até 2', familia: 'até 3', plus: 'ilimitados' },
  { recurso: 'Rede de apoio', basico: '— (só você)', familia: 'você + 1 pessoa', plus: 'ilimitada' },
  { recurso: 'Reconhecimento de foto, print, texto e documentos', basico: `${PLAN_LIMITS.basico.aiPerMonth} por mês`, familia: 'ilimitado', plus: 'ilimitado' },
  { recurso: 'Reconhecimento por voz', basico: false, familia: true, plus: true },
  { recurso: 'Resumo diário no WhatsApp', basico: false, familia: true, plus: true },
  { recurso: 'Cofre de documentos', basico: '200 MB', familia: '1 GB', plus: '5 GB' },
  { recurso: 'Logística de leva e busca', basico: false, familia: true, plus: true },
  { recurso: 'Calendário, mensalidades e alertas no app', basico: true, familia: true, plus: true },
  { recurso: 'Suporte prioritário', basico: false, familia: false, plus: true },
]

/** T2 — frase curta da oferta. */
export const FRASE_OFERTA = `${DIAS_TESTE} dias grátis. Cancele quando quiser, sem nenhuma cobrança durante o teste.`

/** T1 — nota abaixo da tabela. */
export const NOTA_TABELA = `${DIAS_TESTE} dias grátis em qualquer plano. O cartão é pedido no cadastro, mas nada é cobrado durante o teste. Cancele quando quiser antes do fim e não paga nada. Depois dos ${DIAS_TESTE} dias, a assinatura é cobrada automaticamente no plano escolhido. Sem fidelidade.`

// ── Modelo antigo (contas criadas antes da virada, teste sem cartão) ────────
// Continuam valendo só para o aviso de fim do teste dessas contas: ao fim do
// teste elas passam para o gratuito (Termos 5.12).

/** O que deixa de funcionar quando o teste antigo acaba sem assinatura. */
export const PERDE_NO_GRATUITO = [
  'o resumo diário das atividades no WhatsApp',
  'o reconhecimento por voz',
  'o reconhecimento ilimitado de fotos e textos (passa a 5 por mês)',
  'o acesso de quem você convidou para a rede de apoio',
  'o envio de novos arquivos ao cofre de documentos',
]
/** O que continua no gratuito — para o aviso não soar como perda total. */
export const CONTINUA_NO_GRATUITO = 'Sua agenda, até 2 filhos, as mensalidades e os documentos já guardados continuam com você.'
