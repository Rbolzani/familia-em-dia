'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { formatPhoneBR, isValidPhoneBR } from '@/lib/cpf'
import { readAttribution, clearAttribution } from '@/lib/attribution'
import { ACQUISITION_OPTIONS } from '@/lib/cadastro-opcoes'
import { medir } from '@/lib/medicao'

interface Props {
  email: string
  initialName: string
  inviteToken?: string | null
}

// Formulário curto para a conta que ficou sem os dados do cadastro — criada
// antes de eles irem para a tela de criar conta. Quem se cadastra hoje não
// passa por aqui (ver src/lib/cadastro.ts). CPF e endereço só na assinatura.
export default function CompletarCadastroClient({ email, initialName, inviteToken }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialName)
  const [phone, setPhone]       = useState('')
  const [source, setSource]     = useState('')
  const [consent, setConsent]   = useState(false)
  const [terms, setTerms]       = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const phoneOk = phone.length === 0 || isValidPhoneBR(phone)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (fullName.trim().length < 2) { setError('Informe seu nome.'); return }
    if (!isValidPhoneBR(phone))     { setError('Celular inválido. Use DDD + número.'); return }
    if (!source)                    { setError('Conte como você nos conheceu.'); return }
    if (!terms)                     { setError('É necessário aceitar os Termos de Uso e a Política de Privacidade.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName, phone,
          acquisition_source: source,
          marketing_consent: consent,
          terms_accepted: terms,
          attribution: readAttribution(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar.')
      clearAttribution()
      medir('cadastro_concluido', { convidado: !!inviteToken, origem: source })
      // Se o usuário chegou por um link de convite, vai para a tela de aceite
      // (ambiente compartilhado) em vez do dashboard da própria conta.
      if (inviteToken) {
        document.cookie = 'pending_invite=; path=/; max-age=0'
        router.push(`/convite/${inviteToken}`)
      } else {
        router.push('/dashboard')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F8F3EA' }}>
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl p-8 animate-fade-up"
          style={{ boxShadow: '0 24px 80px rgba(44,74,46,0.10), 0 0 0 1px rgba(61,102,65,0.08)' }}>

          <div className="mb-7">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#3D6641' }}>
              Quase lá ✨
            </p>
            <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 28, color: '#1A2B1C', lineHeight: 1.2 }}>
              Falta só um passo
            </h1>
            <p className="text-sm mt-2" style={{ color: 'rgba(26,43,28,0.55)' }}>
              Três informações rápidas e você já entra no app. Sem CPF e sem cartão.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>Seu nome</label>
              <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Maria Silva" className="input-field" />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>E-mail</label>
              <input type="email" value={email} disabled className="input-field" style={{ opacity: 0.6 }} />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'rgba(26,43,28,0.55)' }}>Celular</label>
              <p className="text-xs mb-2" style={{ color: 'rgba(26,43,28,0.40)' }}>Para receber o resumo diário no WhatsApp</p>
              <input type="tel" inputMode="numeric" required value={phone}
                onChange={e => setPhone(formatPhoneBR(e.target.value))}
                placeholder="(11) 90000-0000" className="input-field"
                style={!phoneOk ? { borderColor: '#E0607A' } : undefined} />
              {!phoneOk && <p className="text-xs mt-1" style={{ color: '#C0405A' }}>Celular incompleto.</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>Como você nos conheceu?</label>
              <select required value={source} onChange={e => setSource(e.target.value)} className="input-field">
                <option value="" disabled>Selecione…</option>
                {ACQUISITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)}
                className="mt-0.5 flex-none" style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
              <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.70)' }}>
                Tenho 18 anos ou mais e aceito os{' '}
                <a href="/termos" target="_blank" className="font-semibold underline" style={{ color: '#3D6641' }}>Termos de Uso</a>
                {' '}e a{' '}
                <a href="/privacidade" target="_blank" className="font-semibold underline" style={{ color: '#3D6641' }}>Política de Privacidade</a>.
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 flex-none" style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
              <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.60)' }}>
                Quero receber dicas, novidades e ofertas da Família em Dia por e-mail e WhatsApp. (opcional)
              </span>
            </label>

            {error && (
              <div className="text-xs font-semibold px-4 py-3 rounded-2xl"
                style={{ background: '#FFF0F4', color: '#C0405A', border: '1px solid rgba(240,100,130,0.2)' }}>
                ⚠ {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
              style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', boxShadow: '0 4px 16px rgba(255,107,92,0.30)' }}>
              {loading
                ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <><span>Entrar no app</span><ArrowRight size={15} /></>
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
