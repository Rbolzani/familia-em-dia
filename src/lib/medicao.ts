// Medição de visitas e conversões, em duas camadas:
//  · Vercel Web Analytics — sem cookies, mede todo mundo (ver VercelAnalytics.tsx);
//  · Google Analytics e Meta Pixel — usam cookies, então SÓ carregam depois do
//    "Aceitar todos" no aviso de cookies. Quem escolhe "Somente essenciais"
//    nunca baixa nenhum dos dois scripts.
//
// Os ids abaixo não são segredos: ficam visíveis no código de qualquer página
// que os usa. (O que é segredo é o token da API de Conversões da Meta, que,
// se um dia for usado, mora só nas env vars da Vercel, sem NEXT_PUBLIC_.)

import { track } from '@vercel/analytics'

export const GA_ID = 'G-5BL00096CV'
export const META_PIXEL_ID = '1421696050174234'
export const CHAVE_CONSENTIMENTO = 'fam-cookie-consent'
export const EVENTO_CONSENTIMENTO = 'fam-cookie-consent'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    __famGoogle?: boolean
    fbq?: ((...args: unknown[]) => void) & { disablePushState?: boolean }
    _fbq?: unknown
    __famMeta?: boolean
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

// O endereço da página acompanha cada medição. Dois tipos de coisa não podem
// ir junto:
//  · segredos de uso único na URL — o token do convite (/convite/<token>) e o
//    token_hash do link de redefinição de senha, que viajam na query string;
//  · identificadores de registros (documento do cofre, filho, atividade).
// Só os parâmetros utm_* sobrevivem: são o que diz de qual campanha veio a visita.
export function limparUrl(href: string): string {
  try {
    const u = new URL(href)
    u.pathname = u.pathname
      .replace(/^\/convite\/[^/]+/, '/convite/[token]')
      .replace(UUID, '[id]')
    const utm = new URLSearchParams()
    u.searchParams.forEach((v, k) => { if (k.toLowerCase().startsWith('utm_')) utm.set(k, v) })
    u.search = utm.toString()
    u.hash = ''
    return u.toString()
  } catch {
    return href
  }
}

export function consentiu(): boolean {
  try { return localStorage.getItem(CHAVE_CONSENTIMENTO) === 'accepted' } catch { return false }
}

// Nestas telas o endereço carrega um segredo de uso único. O Google lê a URL
// real da página no instante em que o script sobe — antes de qualquer limpeza
// nossa valer. Então aqui ele simplesmente não sobe; entra na tela seguinte.
const ROTAS_SEM_GOOGLE = [/^\/convite\//, /^\/auth\/(reset-password|confirm|callback)/]

export function carregarGoogle(): void {
  if (typeof window === 'undefined' || window.__famGoogle || !GA_ID || !consentiu()) return
  if (ROTAS_SEM_GOOGLE.some(r => r.test(window.location.pathname))) return
  window.__famGoogle = true
  window.dataLayer = window.dataLayer || []
  // O gtag exige o objeto `arguments`, não um array.
  window.gtag = function gtag() { window.dataLayer!.push(arguments) } // eslint-disable-line prefer-rest-params
  window.gtag('js', new Date())
  // send_page_view:false — as páginas vistas saem de `paginaVista`, com a URL limpa.
  window.gtag('config', GA_ID, { send_page_view: false, page_location: limparUrl(window.location.href) })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)
}

// ── Meta Pixel ──────────────────────────────────────────────────────────────
// Mais restrito que o Google, por três motivos:
//  · o Pixel envia o endereço cru da página (não há como limpar), então não
//    sobe onde o endereço carrega segredo (mesma lista do Google);
//  · o app guarda dados de saúde das crianças, e a Meta não pode receber nada
//    que indique isso. Página vista só sai nas telas do funil de aquisição
//    (ROTAS_COM_META); nas telas internas (saúde, cofre, escola…) nada é enviado;
//  · `autoConfig` desligado: sem ele o Pixel lê botões e textos da página
//    sozinho. `disablePushState`: sem ele cada troca de tela do app viraria
//    uma página vista automática. Só sai o que este arquivo manda.
const ROTAS_COM_META = [/^\/$/, /^\/auth\/(signup|login)\/?$/, /^\/planos\/?$/, /^\/assinar\/?$/]

export function carregarMeta(): void {
  if (typeof window === 'undefined' || window.__famMeta || !META_PIXEL_ID || !consentiu()) return
  if (ROTAS_SEM_GOOGLE.some(r => r.test(window.location.pathname))) return
  window.__famMeta = true
  // Fila mínima no lugar do snippet oficial: guarda as chamadas até o script
  // da Meta chegar, que então as processa.
  const fila: unknown[] = []
  const fbq = function fbq() {
    const f = window.fbq as unknown as { callMethod?: (...a: unknown[]) => void }
    if (f.callMethod) f.callMethod.apply(window.fbq, arguments as unknown as unknown[]) // eslint-disable-line prefer-rest-params
    else fila.push(arguments) // eslint-disable-line prefer-rest-params
  } as unknown as NonNullable<Window['fbq']> & Record<string, unknown>
  Object.assign(fbq, { queue: fila, push: fbq, loaded: true, version: '2.0' })
  fbq.disablePushState = true
  window.fbq = fbq
  if (!window._fbq) window._fbq = fbq
  window.fbq('set', 'autoConfig', false, META_PIXEL_ID)
  window.fbq('init', META_PIXEL_ID)
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(s)
}

function metaPermitidaAqui(): boolean {
  return ROTAS_COM_META.some(r => r.test(window.location.pathname))
}

export function paginaVista(): void {
  if (typeof window === 'undefined') return
  if (metaPermitidaAqui()) {
    carregarMeta()
    try { if (window.__famMeta && window.fbq) window.fbq('track', 'PageView') } catch { /* nunca derruba a tela */ }
  }
  if (!window.__famGoogle || !window.gtag) return
  const url = limparUrl(window.location.href)
  // `set` vale para os eventos seguintes também (rolagem, cliques de saída…),
  // que de outro modo levariam o endereço cru da página.
  window.gtag('set', { page_location: url })
  window.gtag('event', 'page_view', { page_location: url, page_title: document.title })
}

// Conversões que a Meta usa para otimizar anúncios. Só o essencial: nada de
// nome, e-mail, telefone ou dado dos filhos. Convidado por link não é
// conversão de anúncio (veio do convite de quem já é cliente).
function paraMeta(nome: string, d: Dados): [string, Record<string, unknown>] | null {
  switch (nome) {
    case 'cadastro_concluido':
      return d.convidado ? null : ['CompleteRegistration', { content_name: String(d.plano ?? '') }]
    case 'checkout_iniciado':
      return ['InitiateCheckout', { content_name: String(d.plano ?? ''), currency: 'BRL' }]
    case 'assinatura_confirmada': {
      // No teste de 14 dias não há cobrança hoje (valor 0): é o início do teste,
      // a conversão que importa na oferta com cartão. Com valor, é assinatura paga.
      const valor = Number(d.valor ?? 0)
      return valor > 0
        ? ['Subscribe', { value: valor, currency: 'BRL', content_name: String(d.plano ?? '') }]
        : ['StartTrial', { value: 0, currency: 'BRL', content_name: String(d.plano ?? '') }]
    }
    default: return null
  }
}

type Dados = Record<string, string | number | boolean | null>

// Nome do evento no Google para cada evento nosso, com os campos que o Google
// reconhece nos relatórios de aquisição e de receita.
function paraGoogle(nome: string, d: Dados): [string, Record<string, unknown>] {
  const item = { item_name: String(d.plano ?? ''), item_variant: String(d.periodo ?? '') }
  switch (nome) {
    case 'cadastro_concluido': return ['sign_up', { method: String(d.origem ?? '') }]
    case 'checkout_iniciado': return ['begin_checkout', { currency: 'BRL', items: [item], lancamento: !!d.lancamento }]
    case 'assinatura_confirmada': return ['purchase', {
      currency: 'BRL', value: Number(d.valor ?? 0), items: [item],
      transaction_id: `${d.plano}-${d.periodo}-${Date.now()}`,
    }]
    default: return [nome, d]
  }
}

// Um ponto único para registrar conversões: vai sempre para a Vercel e, se a
// pessoa consentiu, também para o Google e para a Meta.
export function medir(nome: string, dados: Dados = {}): void {
  try { track(nome, dados) } catch { /* medição nunca derruba a tela */ }
  try {
    if (typeof window !== 'undefined' && window.__famGoogle && window.gtag) {
      const [evento, params] = paraGoogle(nome, dados)
      window.gtag('event', evento, params)
    }
  } catch { /* idem */ }
  try {
    const meta = typeof window !== 'undefined' ? paraMeta(nome, dados) : null
    if (meta) {
      // A volta do pagamento cai no Início, onde o Pixel não sobe sozinho:
      // carrega aqui, só para a conversão (sem página vista).
      carregarMeta()
      if (window.__famMeta && window.fbq) window.fbq('track', meta[0], meta[1])
    }
  } catch { /* idem */ }
}
