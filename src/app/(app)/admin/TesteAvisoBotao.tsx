'use client'
import { useState } from 'react'

// Manda para o fundador logado o aviso de fim do teste (WhatsApp + e-mail),
// exatamente como o cliente recebe. Ver /api/admin/teste-aviso-fim.
type Resultado = { whatsapp: boolean; modelo: string | null; email: boolean; erros: string[] }

export default function TesteAvisoBotao() {
  const [estado, setEstado] = useState<'parado' | 'enviando' | 'feito'>('parado')
  const [r, setR] = useState<Resultado | null>(null)

  async function enviar() {
    setEstado('enviando'); setR(null)
    try {
      const res = await fetch('/api/admin/teste-aviso-fim', { method: 'POST' })
      setR(res.ok ? await res.json() : { whatsapp: false, modelo: null, email: false, erros: ['HTTP ' + res.status] })
    } catch {
      setR({ whatsapp: false, modelo: null, email: false, erros: ['sem conexão'] })
    }
    setEstado('feito')
  }

  return (
    <div>
      <button type="button" onClick={enviar} disabled={estado === 'enviando'}
        style={{ background: '#3D6641', color: '#fff', border: 0, borderRadius: 12, padding: '10px 16px', fontWeight: 700, fontSize: 13.5, cursor: estado === 'enviando' ? 'wait' : 'pointer', opacity: estado === 'enviando' ? 0.6 : 1 }}>
        {estado === 'enviando' ? 'Enviando…' : 'Enviar para mim um teste do aviso'}
      </button>
      {r && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          <li>WhatsApp: {r.whatsapp ? `enviado (${r.modelo === 'fim_teste' ? 'modelo com o botão de assinatura' : 'modelo de reserva, sem botão'})` : 'não enviado'}</li>
          <li>E-mail: {r.email ? 'enviado' : 'não enviado'}</li>
          {r.erros.length > 0 && <li style={{ color: '#B45309' }}>Detalhes: {r.erros.join(' · ')}</li>}
        </ul>
      )}
    </div>
  )
}
