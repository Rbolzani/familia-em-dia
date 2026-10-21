'use client'
// Faixa "Confirme seu e-mail" (confirmação sem bloquear, 21/10/2026). Aparece
// para quem criou a conta pelo cadastro do modelo novo até clicar no link do
// e-mail. Não se fecha: é por e-mail que chegam os avisos antes da cobrança.
// Depois do clique (/api/email/confirmar → /dashboard?email=confirmado) mostra
// uma confirmação curta, que se fecha.
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Mail, Check, X } from 'lucide-react'

export default function EmailConfirmBanner({ pendente, email }: { pendente: boolean; email: string }) {
  const params = useSearchParams()
  const retorno = params.get('email')
  const [estado, setEstado] = useState<'parado' | 'enviando' | 'enviado' | 'erro'>('parado')
  const [erro, setErro] = useState('')
  const [fechada, setFechada] = useState(false)

  if (!pendente) {
    if (retorno !== 'confirmado' || fechada) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'linear-gradient(135deg,rgba(61,102,65,0.10),rgba(44,74,46,0.06))', border: '1px solid rgba(61,102,65,0.20)', borderRadius: 14, margin: '0 0 12px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Check size={15} color="white" />
        </div>
        <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#2C4A2E', margin: 0, lineHeight: 1.4 }}>E-mail confirmado. Obrigado!</p>
        <button onClick={() => setFechada(true)} aria-label="Fechar" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#2C4A2E', opacity: 0.55 }}>
          <X size={14} />
        </button>
      </div>
    )
  }

  async function reenviar() {
    setEstado('enviando'); setErro('')
    try {
      const res = await fetch('/api/email/reenviar', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok) setEstado('enviado')
      else { setEstado('erro'); setErro(d.error || 'Não conseguimos enviar agora.') }
    } catch {
      setEstado('erro'); setErro('Não conseguimos enviar agora.')
    }
  }

  const texto = estado === 'enviado'
    ? <>Enviamos um novo link para <strong>{email}</strong>. Confira também o spam.</>
    : retorno === 'link-invalido'
      ? <>Esse link de confirmação não vale mais. Peça um novo para <strong>{email}</strong>.</>
      : <><strong>Confirme seu e-mail.</strong> Enviamos um link para <strong>{email}</strong> — é por ele que chegam os avisos da sua assinatura.</>

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', border: '1px solid rgba(245,158,11,0.40)', borderRadius: 14, margin: '0 0 12px' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: 'linear-gradient(140deg,#F59E0B,#D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Mail size={15} color="white" />
      </div>
      <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#92400E', margin: 0, lineHeight: 1.4 }}>
        {texto}
        {estado === 'erro' && <span style={{ display: 'block', fontWeight: 500 }}>{erro}</span>}
      </p>
      {estado !== 'enviado' && (
        <button onClick={reenviar} disabled={estado === 'enviando'} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(140deg,#F59E0B,#D97706)', color: 'white', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', opacity: estado === 'enviando' ? 0.6 : 1 }}>
          {estado === 'enviando' ? 'Enviando…' : 'Reenviar'}
        </button>
      )}
    </div>
  )
}
