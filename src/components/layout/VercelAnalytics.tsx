'use client'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

// O endereço da página vai para a Vercel a cada visita. Dois tipos de coisa
// não podem ir junto:
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

function antesDeEnviar(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: limparUrl(event.url) }
}

// Medição de visitas sem cookies (Vercel Web Analytics). Ativa só em produção:
// em desenvolvimento o pacote não envia nada.
export default function VercelAnalytics() {
  return <Analytics beforeSend={antesDeEnviar} />
}
