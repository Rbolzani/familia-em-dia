'use client'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'
import { limparUrl } from '@/lib/medicao'

function antesDeEnviar(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: limparUrl(event.url) }
}

// Medição de visitas sem cookies (Vercel Web Analytics). Ativa só em produção:
// em desenvolvimento o pacote não envia nada. A limpeza do endereço (tokens e
// ids fora, só utm_* dentro) está em `limparUrl`.
export default function VercelAnalytics() {
  return <Analytics beforeSend={antesDeEnviar} />
}
