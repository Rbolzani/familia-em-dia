'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { EVENTO_CONSENTIMENTO, carregarGoogle, medir, paginaVista } from '@/lib/medicao'

// Liga o Google Analytics e o Meta Pixel quando — e só quando — a pessoa
// aceitou os cookies, e registra cada tela aberta (o Google com o endereço já
// limpo; a Meta só nas telas do funil — ver ROTAS_COM_META em lib/medicao.ts).
export default function MedicaoComConsentimento() {
  const pathname = usePathname()

  // O aceite pode acontecer com a página já aberta: o banner avisa por evento.
  useEffect(() => {
    const aoConsentir = () => { carregarGoogle(); paginaVista() }
    window.addEventListener(EVENTO_CONSENTIMENTO, aoConsentir)
    return () => window.removeEventListener(EVENTO_CONSENTIMENTO, aoConsentir)
  }, [])

  useEffect(() => {
    carregarGoogle()

    // Volta do pagamento: /api/stripe/return entrega a pessoa aqui com
    // ?assinou=<plano>-<periodo>&valor=<reais>. Registra a compra uma vez e
    // tira os parâmetros do endereço, para um recarregar não contar de novo.
    const params = new URLSearchParams(window.location.search)
    const assinou = params.get('assinou')
    if (assinou) {
      const [plano, periodo] = assinou.split('-')
      params.delete('assinou')
      const valor = Number(params.get('valor') ?? 0)
      params.delete('valor')
      // event_id da Meta (ver lib/meta-conversoes.ts): só formatos conhecidos.
      const ev = params.get('ev') ?? ''
      params.delete('ev')
      const eventId = /^(trial|purchase)_[A-Za-z0-9_]+$/.test(ev) ? ev : ''
      const resto = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (resto ? `?${resto}` : ''))
      paginaVista()
      medir('assinatura_confirmada', { plano: plano ?? '', periodo: periodo ?? '', valor, ...(eventId ? { event_id: eventId } : {}) })
      return
    }
    paginaVista()
  }, [pathname])

  return null
}
