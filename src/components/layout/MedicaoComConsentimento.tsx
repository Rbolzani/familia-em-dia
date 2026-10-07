'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { EVENTO_CONSENTIMENTO, carregarGoogle, medir, paginaVista } from '@/lib/medicao'

// Liga o Google Analytics quando — e só quando — a pessoa aceitou os cookies,
// e registra cada tela aberta com o endereço já limpo.
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
      const resto = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (resto ? `?${resto}` : ''))
      paginaVista()
      medir('assinatura_confirmada', { plano: plano ?? '', periodo: periodo ?? '', valor })
      return
    }
    paginaVista()
  }, [pathname])

  return null
}
