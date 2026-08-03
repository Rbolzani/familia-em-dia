'use client'
// Edição inline de uma atividade (título, data, horário e local), usada na
// tela inicial, no mini-calendário e no calendário completo. Centraliza o
// UPDATE no Supabase para as três telas não duplicarem a mesma gravação.
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/Toast'
import { Loader2, Check } from 'lucide-react'

export interface ActivityPatch {
  title: string
  date: string | null
  time: string | null
  location: string | null
}

const INPUT: React.CSSProperties = {
  color: '#1A2B1C',
  background: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(61,102,65,0.28)',
  borderRadius: 8,
  padding: '4px 7px',
  outline: 'none',
  minWidth: 0,
}

export function ActivityQuickEdit({ ids, initial, onDone, onSaved }: {
  // Uma linha visual pode representar várias atividades (a mesma atividade
  // para filhos diferentes, agrupada por mergeActivities) — a edição vale
  // para todas elas, por isso recebemos uma lista de ids.
  ids: string[]
  initial: ActivityPatch
  onDone: () => void
  onSaved?: (patch: ActivityPatch) => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState<ActivityPatch>(initial)
  const [saving, setSaving] = useState(false)

  async function save() {
    const title = form.title.trim()
    if (!title) { toast('O título não pode ficar vazio.', 'error'); return }
    const patch: ActivityPatch = {
      title,
      date: form.date || null,
      time: form.time || null,
      location: form.location?.trim() || null,
    }
    setSaving(true)
    const { error } = await supabase.from('activities').update(patch).in('id', ids)
    setSaving(false)
    if (error) { toast('Não foi possível salvar. Tente novamente.', 'error'); return }
    toast('Atividade atualizada ✓')
    onSaved?.(patch)
    onDone()
  }

  return (
    <div className="space-y-1.5"
      // Estes editores vivem dentro de cards clicáveis (link para a categoria)
      // e do bottom sheet arrastável do mobile — sem isolar o evento, digitar
      // navegaria de página ou arrastaria a folha.
      onClick={e => { e.stopPropagation(); e.preventDefault() }}
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}>
      <input type="text" value={form.title} autoFocus placeholder="Título"
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        className="w-full font-semibold text-sm" style={INPUT} />
      <div className="flex gap-1.5">
        <input type="date" value={form.date ?? ''}
          onChange={e => setForm(f => ({ ...f, date: e.target.value || null }))}
          className="text-xs flex-1" style={INPUT} />
        <input type="time" value={form.time ?? ''}
          onChange={e => setForm(f => ({ ...f, time: e.target.value || null }))}
          className="text-xs" style={{ ...INPUT, width: 92 }} />
      </div>
      <input type="text" value={form.location ?? ''} placeholder="Local"
        onChange={e => setForm(f => ({ ...f, location: e.target.value || null }))}
        className="w-full text-xs" style={INPUT} />
      <div className="flex gap-1.5 pt-0.5">
        <button onClick={save} disabled={saving}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[9px] text-xs font-bold transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', color: '#fff' }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
        <button onClick={onDone} disabled={saving}
          className="px-3 py-1.5 rounded-[9px] text-xs font-bold transition-all disabled:opacity-60"
          style={{ background: 'rgba(26,43,28,0.06)', color: 'rgba(26,43,28,0.55)', border: '1px solid rgba(61,102,65,0.16)' }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
