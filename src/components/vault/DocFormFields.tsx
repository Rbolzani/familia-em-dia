'use client'
import React from 'react'
import { Plus, X } from 'lucide-react'
import { getDocType, dosesRealmentePendentes, type DocType, type DocField, type VacinaItem } from '@/lib/docTypes'

interface Props {
  docType: DocType
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

const LABEL = 'block text-[11px] font-bold uppercase tracking-wider mb-1.5'
const LABEL_STYLE: React.CSSProperties = { color: 'rgba(26,43,28,0.50)' }

function maskCpfCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) {
    const p1 = d.slice(0, 3), p2 = d.slice(3, 6), p3 = d.slice(6, 9), p4 = d.slice(9, 11)
    let r = p1
    if (p2) r += '.' + p2
    if (p3) r += '.' + p3
    if (p4) r += '-' + p4
    return r
  }
  const p1 = d.slice(0, 2), p2 = d.slice(2, 5), p3 = d.slice(5, 8), p4 = d.slice(8, 12), p5 = d.slice(12, 14)
  let r = p1
  if (p2) r += '.' + p2
  if (p3) r += '.' + p3
  if (p4) r += '/' + p4
  if (p5) r += '-' + p5
  return r
}

// Renderiza dinamicamente os campos específicos da natureza do documento.
// Usado nos formulários de upload (overview/gaveta) e na edição do detalhe.
export default function DocFormFields({ docType, values, onChange }: Props) {
  const def = getDocType(docType)
  // Some sozinho quando o usuário registra a dose na lista acima.
  const pendentes = dosesRealmentePendentes(
    values.vacinas as VacinaItem[] | undefined,
    values.doses_pendentes as string[] | undefined,
  )
  return (
    <>
      {def.fields.map(f => (
        <Field key={f.key} f={f} value={values[f.key]} onChange={v => onChange(f.key, v)} />
      ))}
      {docType === 'vacinacao' && pendentes.length > 0 && (
        <DosesPendentesSugestao
          doses={pendentes}
          criar={values.criar_lembrete_doses !== false}
          onToggle={v => onChange('criar_lembrete_doses', v)}
        />
      )}
    </>
  )
}

// O OCR detectou um bloco de dose IMPRESSO e em branco no comprovante.
// Sugere criar um lembrete no mural — sem criar nada sozinho, porque o
// usuário está apenas subindo um arquivo e não pediu tarefa nenhuma.
function DosesPendentesSugestao({ doses, criar, onToggle }: {
  doses: string[]; criar: boolean; onToggle: (v: boolean) => void
}) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.24)' }}>
      <p className="text-[12.5px] font-bold mb-1" style={{ color: '#92400E' }}>
        {doses.length === 1 ? 'Uma dose parece não registrada' : 'Algumas doses parecem não registradas'}
      </p>
      <p className="text-[11.5px] mb-2" style={{ color: 'rgba(26,43,28,0.60)' }}>
        No comprovante, {doses.map(d => `“${d}”`).join(', ')} {doses.length === 1 ? 'está' : 'estão'} sem data preenchida.
      </p>
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={criar} onChange={e => onToggle(e.target.checked)}
          style={{ accentColor: '#D97706', width: 16, height: 16 }} />
        <span className="text-[12.5px] font-semibold" style={{ color: '#1A2B1C' }}>
          Criar lembrete no mural
        </span>
      </label>
    </div>
  )
}

function Field({ f, value, onChange }: { f: DocField; value: unknown; onChange: (v: unknown) => void }) {
  if (f.format === 'vacinas') {
    return <VacinasEditor label={f.label} items={(value as VacinaItem[]) ?? []} onChange={onChange} />
  }
  if (f.format === 'sim_nao') {
    return (
      <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
          style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
        <span className="text-sm font-medium" style={{ color: '#1A2B1C' }}>{f.label}</span>
      </label>
    )
  }
  if (f.format === 'textarea') {
    return (
      <div>
        <label className={LABEL} style={LABEL_STYLE}>{f.label}</label>
        <textarea className="input-field w-full resize-none" rows={2}
          value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
      </div>
    )
  }
  if (f.format === 'cpf_cnpj') {
    return (
      <div>
        <label className={LABEL} style={LABEL_STYLE}>{f.label}</label>
        <input type="text" inputMode="numeric" className="input-field w-full"
          placeholder="000.000.000-00" maxLength={18}
          value={(value as string) ?? ''} onChange={e => onChange(maskCpfCnpj(e.target.value))} />
      </div>
    )
  }
  const type = f.format === 'data' ? 'date' : 'text'
  const placeholder =
    f.format === 'valor' ? 'R$ 0,00' :
    f.format === 'crm' ? 'CRM/UF 000000' : undefined
  return (
    <div>
      <label className={LABEL} style={LABEL_STYLE}>{f.label}</label>
      <input type={type} inputMode={f.format === 'valor' ? 'decimal' : undefined}
        className="input-field w-full" placeholder={placeholder}
        value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function VacinasEditor({ label, items, onChange }: { label: string; items: VacinaItem[]; onChange: (v: VacinaItem[]) => void }) {
  function update(i: number, patch: Partial<VacinaItem>) {
    onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it))
  }
  function add() {
    onChange([...items, { nome: '', data_aplicacao: null, dose: null }])
  }
  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i))
  }
  return (
    <div>
      <label className={LABEL} style={LABEL_STYLE}>{label}</label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-xl p-2.5 space-y-2" style={{ background: 'rgba(61,102,65,0.06)', border: '1px solid rgba(61,102,65,0.14)' }}>
            <div className="flex items-center gap-2">
              <input className="input-field w-full" placeholder="Vacina (ex: Tríplice viral)"
                value={it.nome ?? ''} onChange={e => update(i, { nome: e.target.value })} />
              <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg hover:bg-black/10 flex-shrink-0" title="Remover">
                <X size={15} color="rgba(26,43,28,0.50)" />
              </button>
            </div>
            {/* Só histórico: o que foi aplicado e quando. Sem "próxima dose" —
                o comprovante não agenda doses futuras. */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-[10px] font-semibold mb-1" style={{ color: 'rgba(26,43,28,0.45)' }}>Aplicada em</span>
                <input type="date" className="input-field w-full" value={it.data_aplicacao ?? ''} onChange={e => update(i, { data_aplicacao: e.target.value || null })} />
              </div>
              <div>
                <span className="block text-[10px] font-semibold mb-1" style={{ color: 'rgba(26,43,28,0.45)' }}>Dose</span>
                <input className="input-field w-full" placeholder="1ª / reforço" value={it.dose ?? ''} onChange={e => update(i, { dose: e.target.value || null })} />
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={add}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed text-xs font-bold transition-colors hover:bg-black/5"
          style={{ borderColor: 'rgba(61,102,65,0.30)', color: '#3D6641' }}>
          <Plus size={13} /> Adicionar vacina
        </button>
      </div>
    </div>
  )
}
