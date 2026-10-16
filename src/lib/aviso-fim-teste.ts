// Server-only: o aviso "seu teste grátis termina em 3 dias", por WhatsApp e
// e-mail, a quem está no teste do Família e ainda não assinou.
//
// É comunicação sobre o estado da conta que a pessoa abriu — não depende do
// opt-in de comunicações promocionais.
// ⚠️ Mudar aqui é mudar o que o cliente lê: o Rogério aprova o texto.
//
// WHATSAPP: DOIS MODELOS
// 1. `fim_teste` (Marketing, aprovado na Meta em 16/10/2026): o texto e o botão
//    "Assinar o plano Família" (link fixo para /planos com utm) moram NA META;
//    o app só preenche {{1}} = quando (`quandoTermina`) e {{2}} = data. Mudar o
//    texto desse modelo é no painel da Meta, não aqui.
// 2. `aviso_conta` (Utilidade, 1 parâmetro), reserva para quando o primeiro
//    falhar: só informa o estado da conta, SEM link nem preço — um modelo de
//    Utilidade que convida a comprar é reclassificado como Marketing.

import { LEGAL_ENTITY } from '@/lib/legal'
import { COMPARATIVO, CONTINUA_NO_GRATUITO, PERDE_NO_GRATUITO, precoPorMes, reais, type Celula } from '@/lib/planos-oferta'

export const REMETENTE_AVISO = `Família em Dia <${LEGAL_ENTITY.email}>`
const SITE = 'https://www.familiaemdia.com.br'
export const LINK_PLANOS_EMAIL = `${SITE}/planos?utm_source=email&utm_medium=email&utm_campaign=fim_teste`
// Com `token` (envio real da rotina), o botão passa por /api/e/c — que registra
// o clique e leva a /planos — e uma imagem invisível (/api/e/a) registra a
// abertura. Sem token (amostra do Painel), o link vai direto e não há imagem.
const linkBotao = (token?: string) => token ? `${SITE}/api/e/c?t=${token}` : LINK_PLANOS_EMAIL
const imagemAbertura = (token?: string) => token
  ? `<img src="${SITE}/api/e/a?t=${token}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
  : ''
const BOTAO = 'Assinar o plano Família'

const diaSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
/**
 * Dias de CALENDÁRIO (fuso de Brasília) até o fim do teste. Contar por horas
 * dava "em 4 dias" para um teste que termina às 21h37 avisado às 20h de três
 * dias antes.
 */
export function diasAteFim(fim: Date, agora = new Date()): number {
  return Math.round((Date.parse(diaSP(fim)) - Date.parse(diaSP(agora))) / 86_400_000)
}
/** "em 3 dias" / "amanhã" / "hoje". */
export function quandoTermina(fim: Date, agora = new Date()): string {
  const dias = diasAteFim(fim, agora)
  return dias <= 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`
}
/** Parâmetros do modelo `fim_teste` da Meta: {{1}} quando, {{2}} data. */
export function paramsModeloFimTeste(fim: Date, agora = new Date()): [string, string] {
  return [quandoTermina(fim, agora), dataCurta(fim)]
}
export function dataCurta(fim: Date): string {
  return fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}
const lista = (itens: string[]) => itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1]

/** Uma frase só: vira o parâmetro do template `aviso_conta`. */
export function avisoWhatsApp(fim: Date): string {
  return `Seu teste grátis do plano Família termina ${quandoTermina(fim)}, em ${dataCurta(fim)}. ` +
    `Depois disso a conta passa para o plano gratuito e deixam de funcionar ${lista(PERDE_NO_GRATUITO)}. ${CONTINUA_NO_GRATUITO}`
}

export function assuntoEmail(fim: Date): string {
  return `Seu teste grátis do Família em Dia termina ${quandoTermina(fim)}`
}

function paragrafos(nome: string | null, fim: Date): string[] {
  return [
    nome ? `Olá, ${nome}!` : 'Olá!',
    `Seu teste grátis do plano Família termina ${quandoTermina(fim)}, no dia ${dataCurta(fim)}. Se você não assinar até lá, a conta passa para o plano gratuito e deixam de funcionar:`,
  ]
}
const DEPOIS_DA_LISTA = `${CONTINUA_NO_GRATUITO} Nada é apagado.`
const PRECO = `O plano Família custa ${reais(precoPorMes('familia', 'month'))} por mês, ou ${reais(precoPorMes('familia', 'year'))} por mês no plano anual (20% de desconto). Sem fidelidade: dá para cancelar quando quiser, dentro do app.`
const DEPOIS_DO_BOTAO = 'Ficou com alguma dúvida? É só responder este e-mail.'
const RODAPE = 'Você recebeu este e-mail porque está no teste grátis de uma conta em familiaemdia.com.br.'

export function emailEmTexto(nome: string | null, fim: Date, token?: string): string {
  const tabela = COMPARATIVO.map(l => `${l.recurso}: Gratuito ${txt(l.gratuito)} · Família ${txt(l.familia)} · Plus ${txt(l.plus)}`).join('\n')
  return [
    ...paragrafos(nome, fim),
    PERDE_NO_GRATUITO.map(i => `• ${i}`).join('\n'),
    DEPOIS_DA_LISTA,
    PRECO,
    `${BOTAO}: ${linkBotao(token)}`,
    'Compare os planos:\n' + tabela,
    DEPOIS_DO_BOTAO,
    'Obrigado,\nFamília em Dia',
    RODAPE,
  ].join('\n\n')
}
function txt(v: Celula) { return v === true ? 'sim' : v === false ? 'não' : v }

export function emailEmHtml(nome: string | null, fim: Date, token?: string): string {
  const fonte = '-apple-system,Segoe UI,sans-serif'
  const p = (t: string) => `<tr><td style="padding:0 0 14px;font:400 15px/1.6 ${fonte};color:#1A2B1C">${t}</td></tr>`
  const cel = (v: Celula, destaque: boolean) =>
    `<td style="padding:7px 4px;text-align:center;font:${destaque ? 700 : 400} 12.5px/1.3 ${fonte};color:${v === false ? '#B8BFB5' : '#1A2B1C'};border-top:1px solid #EFE8DA;${destaque ? 'background:#EEF4EE;' : ''}">${v === true ? '✓' : v === false ? '—' : v}</td>`
  const tabela = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr><td style="padding:0 0 6px;font:600 11px ${fonte};color:#7A8577"></td><td style="text-align:center;font:700 12.5px ${fonte};color:#1A2B1C;padding:0 4px 6px">Gratuito</td><td style="text-align:center;font:800 12.5px ${fonte};color:#2C4A2E;padding:6px 4px;background:#EEF4EE;border-radius:8px 8px 0 0">Família</td><td style="text-align:center;font:700 12.5px ${fonte};color:#1A2B1C;padding:0 4px 6px">Plus</td></tr>
      ${COMPARATIVO.map(l => `<tr><td style="padding:7px 6px 7px 0;font:400 12.5px/1.3 ${fonte};color:#4A5A4C;border-top:1px solid #EFE8DA">${l.recurso}</td>${cel(l.gratuito, false)}${cel(l.familia, true)}${cel(l.plus, false)}</tr>`).join('\n      ')}
    </table>`
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8F3EA;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:22px 24px">
    ${paragrafos(nome, fim).map(p).join('\n    ')}
    <tr><td style="padding:0 0 14px"><ul style="margin:0;padding-left:20px;font:400 15px/1.7 ${fonte};color:#1A2B1C">${PERDE_NO_GRATUITO.map(i => `<li>${i}</li>`).join('')}</ul></td></tr>
    ${p(DEPOIS_DA_LISTA)}
    ${p(PRECO)}
    <tr><td style="padding:4px 0 22px">
      <a href="${linkBotao(token)}" style="display:inline-block;background:#3D6641;color:#fff;text-decoration:none;font:700 14px ${fonte};padding:12px 20px;border-radius:12px">${BOTAO}</a>
    </td></tr>
    <tr><td style="padding:0 0 8px;font:700 14px ${fonte};color:#1A2B1C">Compare os planos</td></tr>
    <tr><td style="padding:0 0 18px">${tabela}</td></tr>
    ${p(DEPOIS_DO_BOTAO)}
    ${p('Obrigado,<br>Família em Dia')}
    <tr><td style="padding:8px 0 0;border-top:1px solid #EFE8DA;font:400 12px/1.5 ${fonte};color:#7A8577">
      <div style="padding-top:12px">${RODAPE}</div>
    </td></tr>
  </table>${imagemAbertura(token)}</body></html>`
}
