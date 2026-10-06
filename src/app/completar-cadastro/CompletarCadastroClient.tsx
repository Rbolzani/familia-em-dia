'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { formatCPF, formatPhoneBR, isValidCPF, isValidPhoneBR } from '@/lib/cpf'
import { readAttribution, clearAttribution } from '@/lib/attribution'
import { EMPTY_ADDRESS, addressError, normalizeAddress, type Address } from '@/lib/address'
import AddressFields from '@/components/AddressFields'

const ACQUISITION_OPTIONS = [
  'Instagram', 'Facebook', 'Google / busca', 'TikTok',
  'Indicação de amigo', 'Grupo de pais / escola', 'YouTube', 'Outro',
]

interface Props {
  email: string
  initialName: string
  inviteToken?: string | null
}

export default function CompletarCadastroClient({ email, initialName, inviteToken }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialName)
  const [phone, setPhone]       = useState('')
  const [cpf, setCpf]           = useState('')
  const [birthDate, setBirth]   = useState('')
  const [address, setAddress]   = useState<Address>(EMPTY_ADDRESS)
  const [source, setSource]     = useState('')
  const [consent, setConsent]   = useState(false)
  const [terms, setTerms]       = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const cpfOk   = cpf.length === 0 || isValidCPF(cpf)
  const phoneOk = phone.length === 0 || isValidPhoneBR(phone)
  // Quem chega por convite entra no ambiente de outra pessoa e não assina:
  // não precisa de endereço (que só existe para a nota fiscal).
  const pedeEndereco = !inviteToken

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (fullName.trim().length < 3) { setError('Informe seu nome completo.'); return }
    if (!isValidPhoneBR(phone))     { setError('Celular inválido. Use DDD + número.'); return }
    if (!isValidCPF(cpf))           { setError('CPF inválido.'); return }
    if (!birthDate)                 { setError('Informe sua data de nascimento.'); return }
    const endereco = normalizeAddress(address)
    if (pedeEndereco) {
      const problema = addressError(endereco)
      if (problema) { setError(problema); return }
    }
    if (!source)                    { setError('Conte como você nos conheceu.'); return }
    if (!terms)                     { setError('É necessário aceitar os Termos de Uso e a Política de Privacidade.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName, phone, cpf, birth_date: birthDate,
          ...(pedeEndereco ? { address: endereco } : {}),
          acquisition_source: source,
          marketing_consent: consent,
          terms_accepted: terms,
          attribution: readAttribution(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar.')
      clearAttribution()
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
              Complete seu cadastro
            </h1>
            <p className="text-sm mt-2" style={{ color: 'rgba(26,43,28,0.55)' }}>
              Precisamos de alguns dados para ativar sua conta com segurança.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>Nome completo</label>
              <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Maria Aparecida da Silva" className="input-field" />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>E-mail</label>
              <input type="email" value={email} disabled className="input-field" style={{ opacity: 0.6 }} />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>Celular</label>
              <input type="tel" inputMode="numeric" required value={phone}
                onChange={e => setPhone(formatPhoneBR(e.target.value))}
                placeholder="(11) 90000-0000" className="input-field"
                style={!phoneOk ? { borderColor: '#E0607A' } : undefined} />
              {!phoneOk && <p className="text-xs mt-1" style={{ color: '#C0405A' }}>Celular incompleto.</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>CPF</label>
              <input type="text" inputMode="numeric" required value={cpf}
                onChange={e => setCpf(formatCPF(e.target.value))}
                placeholder="000.000.000-00" className="input-field"
                style={!cpfOk ? { borderColor: '#E0607A' } : undefined} />
              {!cpfOk && <p className="text-xs mt-1" style={{ color: '#C0405A' }}>CPF inválido.</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>Data de nascimento</label>
              <input type="date" required value={birthDate} onChange={e => setBirth(e.target.value)}
                max={new Date().toISOString().slice(0, 10)} className="input-field" />
            </div>

            {pedeEndereco && (
              <div className="pt-2">
                <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#3D6641' }}>Endereço</p>
                <p className="text-xs mb-3" style={{ color: 'rgba(26,43,28,0.50)' }}>
                  Digite o CEP e preenchemos o resto. Usamos na nota fiscal, se você assinar.
                </p>
                <AddressFields value={address} onChange={setAddress} />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>Como você nos conheceu?</label>
              <select required value={source} onChange={e => setSource(e.target.value)} className="input-field">
                <option value="" disabled>Selecione…</option>
                {ACQUISITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)}
                className="mt-0.5" style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
              <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.70)' }}>
                Li e aceito os{' '}
                <a href="/termos" target="_blank" className="font-semibold underline" style={{ color: '#3D6641' }}>Termos de Uso</a>
                {' '}e a{' '}
                <a href="/privacidade" target="_blank" className="font-semibold underline" style={{ color: '#3D6641' }}>Política de Privacidade</a>.
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                className="mt-0.5" style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
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
                : <><span>Continuar</span><ArrowRight size={15} /></>
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
