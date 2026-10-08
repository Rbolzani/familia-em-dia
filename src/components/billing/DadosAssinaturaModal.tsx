'use client'
import { useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import AddressFields from '@/components/AddressFields'
import { formatCPF, formatPhoneBR, isValidCPF, isValidPhoneBR } from '@/lib/cpf'
import { EMPTY_ADDRESS, addressError, normalizeAddress, type Address } from '@/lib/address'

interface Props {
  open: boolean
  onClose: () => void
  /** Dados gravados: quem chamou segue para o pagamento. */
  onSalvo: () => void
}

const labelStyle = { color: 'rgba(26,43,28,0.55)' } as const

// Nome completo, CPF e endereço — o que a nota fiscal exige. A conta grátis
// não pede nada disso; aparece só quando a pessoa decide assinar e o servidor
// responde `dados_pendentes` (/api/stripe/checkout).
export default function DadosAssinaturaModal({ open, onClose, onSalvo }: Props) {
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome]       = useState('')
  const [celular, setCelular] = useState('')
  const [cpf, setCpf]         = useState('')
  const [temCpf, setTemCpf]   = useState(false)
  const [endereco, setEndereco] = useState<Address>(EMPTY_ADDRESS)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]       = useState('')

  useEffect(() => {
    if (!open) return
    let vivo = true
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        if (!vivo) return
        setNome(d.full_name ?? '')
        setCelular(d.phone ? formatPhoneBR(d.phone) : '')
        setTemCpf(!!d.tem_cpf)
        if (d.address) setEndereco({ ...EMPTY_ADDRESS, ...d.address })
      })
      .catch(() => { /* sem pré-preenchimento: os campos seguem editáveis */ })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [open])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (nome.trim().split(/\s+/).filter(p => p.length >= 2).length < 2) { setErro('Informe nome e sobrenome, como devem sair na nota fiscal.'); return }
    if (!temCpf && !isValidCPF(cpf)) { setErro('CPF inválido.'); return }
    if (!isValidPhoneBR(celular)) { setErro('Celular inválido. Use DDD + número.'); return }
    const end = normalizeAddress(endereco)
    const problema = addressError(end)
    if (problema) { setErro(problema); return }

    setSalvando(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: nome, phone: celular, ...(temCpf ? {} : { cpf }), address: end }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar.')
      onSalvo()
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Erro desconhecido.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!salvando) onClose() }} title="Dados para a assinatura" size="md">
      {carregando ? (
        <div className="py-10 flex justify-center"><Loader2 size={20} className="animate-spin" style={{ color: '#3D6641' }} /></div>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.65)', lineHeight: 1.5 }}>
            Pedimos estes dados uma única vez. Eles saem na nota fiscal da sua assinatura.
            Em seguida você vai para o pagamento.
          </p>

          <div>
            <label className="block text-xs font-semibold mb-2" style={labelStyle}>Nome completo</label>
            <input type="text" required value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Maria Aparecida da Silva" autoComplete="name" className="input-field" />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={labelStyle}>
              CPF {temCpf && <Lock size={11} />}
            </label>
            {temCpf ? (
              <input type="text" value="Já cadastrado" disabled className="input-field" style={{ opacity: 0.6 }} />
            ) : (
              <input type="text" inputMode="numeric" required value={cpf}
                onChange={e => setCpf(formatCPF(e.target.value))}
                placeholder="000.000.000-00" className="input-field" />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-2" style={labelStyle}>Celular</label>
            <input type="tel" inputMode="numeric" required value={celular}
              onChange={e => setCelular(formatPhoneBR(e.target.value))}
              placeholder="(11) 90000-0000" className="input-field" />
          </div>

          <div className="pt-1">
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#3D6641' }}>Endereço</p>
            <p className="text-xs mb-3" style={{ color: 'rgba(26,43,28,0.50)' }}>Digite o CEP e preenchemos o resto.</p>
            <AddressFields value={endereco} onChange={setEndereco} />
          </div>

          {erro && (
            <div className="text-xs font-semibold px-4 py-3 rounded-2xl"
              style={{ background: '#FFF0F4', color: '#C0405A', border: '1px solid rgba(240,100,130,0.2)' }}>
              ⚠ {erro}
            </div>
          )}

          <button type="submit" disabled={salvando}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
            style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', boxShadow: '0 4px 16px rgba(255,107,92,0.30)' }}>
            {salvando && <Loader2 size={14} className="animate-spin" />}
            Salvar e ir para o pagamento
          </button>
        </form>
      )}
    </Modal>
  )
}
