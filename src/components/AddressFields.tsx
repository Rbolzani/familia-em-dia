'use client'
import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { type Address, UFS, formatCEP } from '@/lib/address'
import { onlyDigits } from '@/lib/cpf'

interface Props {
  value: Address
  onChange: (next: Address) => void
}

const labelStyle = { color: 'rgba(26,43,28,0.55)' } as const

// Campos de endereço com preenchimento pelo CEP. A busca é só conveniência:
// se falhar, os campos continuam editáveis à mão.
export default function AddressFields({ value, onChange }: Props) {
  const [buscando, setBuscando] = useState(false)
  const [naoAchou, setNaoAchou] = useState(false)
  const numeroRef = useRef<HTMLInputElement>(null)
  const ultimaBusca = useRef('')

  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch })

  async function handleCep(raw: string) {
    const cep = onlyDigits(raw).slice(0, 8)
    set({ cep })
    setNaoAchou(false)
    if (cep.length !== 8 || cep === ultimaBusca.current) return
    ultimaBusca.current = cep
    setBuscando(true)
    try {
      const res = await fetch(`/api/cep?cep=${cep}`)
      const d = await res.json()
      if (res.ok && d.found) {
        // Não apaga o que a pessoa já digitou quando o CEP é genérico (cidade
        // inteira) e vem sem rua/bairro.
        onChange({
          ...value, cep,
          street: d.street || value.street,
          district: d.district || value.district,
          city: d.city || value.city,
          state: d.state || value.state,
        })
        numeroRef.current?.focus()
      } else {
        setNaoAchou(true)
      }
    } catch {
      setNaoAchou(true)
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={labelStyle}>
          CEP {buscando && <Loader2 size={11} className="animate-spin" />}
        </label>
        <input type="text" inputMode="numeric" autoComplete="postal-code" required
          value={formatCEP(value.cep)} onChange={e => handleCep(e.target.value)}
          placeholder="00000-000" className="input-field" />
        {naoAchou && (
          <p className="text-xs mt-1" style={labelStyle}>Não encontramos esse CEP. Preencha o endereço abaixo.</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold mb-2" style={labelStyle}>Rua</label>
        <input type="text" autoComplete="address-line1" required maxLength={120}
          value={value.street} onChange={e => set({ street: e.target.value })}
          placeholder="Rua das Flores" className="input-field" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Número</label>
          <input ref={numeroRef} type="text" required maxLength={12}
            value={value.number} onChange={e => set({ number: e.target.value })}
            placeholder="123" className="input-field" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Complemento (opcional)</label>
          <input type="text" autoComplete="address-line2" maxLength={60}
            value={value.complement} onChange={e => set({ complement: e.target.value })}
            placeholder="Apto 42" className="input-field" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold mb-2" style={labelStyle}>Bairro</label>
        <input type="text" required maxLength={80}
          value={value.district} onChange={e => set({ district: e.target.value })}
          className="input-field" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Cidade</label>
          <input type="text" autoComplete="address-level2" required maxLength={80}
            value={value.city} onChange={e => set({ city: e.target.value })}
            className="input-field" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Estado</label>
          <select required autoComplete="address-level1" value={value.state}
            onChange={e => set({ state: e.target.value })} className="input-field">
            <option value="" disabled>UF</option>
            {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
