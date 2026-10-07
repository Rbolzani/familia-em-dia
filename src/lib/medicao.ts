// Medição de visitas e conversões, em duas camadas:
//  · Vercel Web Analytics — sem cookies, mede todo mundo (ver VercelAnalytics.tsx);
//  · Google Analytics — usa cookies, então SÓ carrega depois do "Aceitar todos"
//    no aviso de cookies. Quem escolhe "Somente essenciais" nunca baixa o script.
//
// Os ids abaixo não são segredos: ficam visíveis no código de qualquer página
// que os usa.

import { track } from '@vercel/analytics'

export const GA_ID = 'G-5BL00096CV'
export const CHAVE_CONSENTIMENTO = 'fam-cookie-consent'
export const EVENTO_CONSENTIMENTO = 'fam-cookie-consent'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    __famGoogle?: boolean
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

export function paginaVista(): void {
  if (typeof window === 'undefined' || !window.__famGoogle || !window.gtag) return
  const url = limparUrl(window.location.href)
  // `set` vale para os eventos seguintes também (rolagem, cliques de saída…),
  // que de outro modo levariam o endereço cru da página.
  window.gtag('set', { page_location: url })
  window.gtag('event', 'page_view', { page_location: url, page_title: document.title })
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
// pessoa consentiu, também para o Google.
export function medir(nome: string, dados: Dados = {}): void {
  try { track(nome, dados) } catch { /* medição nunca derruba a tela */ }
  try {
    if (typeof window !== 'undefined' && window.__famGoogle && window.gtag) {
      const [evento, params] = paraGoogle(nome, dados)
      window.gtag('event', evento, params)
    }
  } catch { /* idem */ }
}
