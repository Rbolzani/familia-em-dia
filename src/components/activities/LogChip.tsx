'use client'
import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Car, Home, ChevronDown, Clock, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/Toast'
import { useUpsell } from '@/components/billing/Upsell'
import { PLAN_LIMITS } from '@/lib/planos-limites'
import { useAccess } from '@/components/access/AccessContext'

export interface LogisticsSuggestion {
  id: string
  activity_id: string
  field: 'takes_user_id' | 'picks_user_id'
  proposed_by: string
  proposed_to: string
  family_id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
}

export interface FamilyMemberInfo {
  user_id: string
  display_name: string | null
  role: string
}

interface ActivityMeta {
  id: string
  title: string
  date: string | null
}

interface Props {
  actId: string
  field: 'takes_user_id' | 'picks_user_id'
  value: string | null
  activity: ActivityMeta
  suggestions: LogisticsSuggestion[]
  familyMembers: FamilyMemberInfo[]
  currentUserId: string
  familyId: string | null
  isOwner: boolean
  onUpdate: (actId: string, field: 'takes_user_id' | 'picks_user_id', newVal: string | null, removeSuggestionId?: string) => void
  onSuggestionCreated?: (sug: LogisticsSuggestion) => void
  /** compact=true used in ActivityCard (smaller width) */
  compact?: boolean
}

export default function LogChip({
  actId, field, value, activity,
  suggestions, familyMembers, currentUserId, familyId, isOwner,
  onUpdate, onSuggestionCreated, compact = false,
}: Props) {
  const supabase = createClient()
  const { canLogistics } = useAccess()
  // Básico não tem logística de leva e busca: as marcações nem aparecem (o
  // cadeado fica no item Logística da barra lateral).
  const { plano } = useUpsell()
  const semLogistica = plano !== 'pausada' && !PLAN_LIMITS[plano].logistics
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!open) return
    function updatePos() {
      if (!btnRef.current) return
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: Math.max(r.width, 160) })
    }
    updatePos()
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open])

  const pendingSug = suggestions.find(s => s.activity_id === actId && s.field === field && s.status === 'pending')

  function memberName(userId: string | null | undefined): string {
    if (!userId) return ''
    if (userId === currentUserId) return 'Você'
    const m = familyMembers.find(fm => fm.user_id === userId)
    if (m) return m.display_name ?? 'Parceiro(a)'
    return 'Ex-parceiro(a)'
  }

  function isOrphaned(userId: string | null | undefined): boolean {
    if (!userId || userId === currentUserId) return false
    return !familyMembers.some(fm => fm.user_id === userId)
  }

  const canSuggestTo = (targetId: string) => {
    if (targetId === currentUserId) return true
    if (isOwner) return true
    const target = familyMembers.find(m => m.user_id === targetId)
    return target?.role === 'owner'
  }

  const confirmedByOther = value && value !== currentUserId && !pendingSug && !isOrphaned(value)

  async function handleSelect(targetUserId: string | null) {
    setOpen(false)
    if (loading) return
    setLoading(true)
    try {
      if (targetUserId === null) {
        if (pendingSug && pendingSug.proposed_by === currentUserId) {
          await supabase.from('logistics_suggestions').delete().eq('id', pendingSug.id)
          onUpdate(actId, field, null, pendingSug.id)
          toast('Sugestão cancelada')
        } else if (!pendingSug && (value === currentUserId || isOrphaned(value))) {
          // Libera o próprio slot OU um slot deixado por ex-parceiro desconectado.
          await supabase.from('activities').update({ [field]: null }).eq('id', actId)
          onUpdate(actId, field, null)
          toast(field === 'takes_user_id' ? 'Você liberou quem leva' : 'Você liberou quem busca')
        }
        return
      }

      if (targetUserId === currentUserId) {
        if (pendingSug && pendingSug.proposed_to === currentUserId) {
          toast('Você tem uma sugestão pendente. Aceite ou recuse primeiro.', 'error')
          return
        }
        await supabase.from('activities').update({ [field]: currentUserId }).eq('id', actId)
        if (pendingSug && pendingSug.proposed_by === currentUserId) {
          await supabase.from('logistics_suggestions').delete().eq('id', pendingSug.id)
          onUpdate(actId, field, currentUserId, pendingSug.id)
        } else {
          onUpdate(actId, field, currentUserId)
        }
        toast(field === 'takes_user_id' ? 'Você assumiu quem leva ✓' : 'Você assumiu quem busca ✓')
        return
      }

      if (pendingSug) { toast('Já há uma sugestão pendente para este slot.', 'error'); return }
      if (!familyId) { toast('Família não encontrada', 'error'); return }

      const { data: sug, error } = await supabase
        .from('logistics_suggestions')
        .insert({ activity_id: actId, field, proposed_by: currentUserId, proposed_to: targetUserId, family_id: familyId, status: 'pending' })
        .select().single()

      if (error && !error.message?.includes('multiple') && !sug) {
        toast('Erro ao criar sugestão', 'error'); return
      }

      // Se SELECT falhou mas INSERT foi OK, monta o objeto localmente
      const newSug: LogisticsSuggestion = sug ?? {
        id: crypto.randomUUID(),
        activity_id: actId,
        field,
        proposed_by: currentUserId,
        proposed_to: targetUserId,
        family_id: familyId!,
        status: 'pending',
        created_at: new Date().toISOString(),
      }

      fetch('/api/logistics-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest', suggestionId: newSug.id, proposedTo: targetUserId, familyId, activityTitle: activity.title }),
      }).catch(() => {})

      onSuggestionCreated?.(newSug)
      onUpdate(actId, field, null)
      toast(`Sugestão enviada para ${memberName(targetUserId)} ✓`)
    } finally {
      setLoading(false)
    }
  }

  async function handleAccept() {
    if (!pendingSug || loading) return
    setLoading(true)
    try {
      await fetch('/api/logistics-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', suggestionId: pendingSug.id, activityId: actId, field, proposedBy: pendingSug.proposed_by, familyId, activityTitle: activity.title }),
      })
      onUpdate(actId, field, currentUserId, pendingSug.id)
      toast('Logística confirmada ✓')
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    if (!pendingSug || loading) return
    setLoading(true)
    try {
      await fetch('/api/logistics-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', suggestionId: pendingSug.id, proposedBy: pendingSug.proposed_by, familyId, activityTitle: activity.title, activityDate: activity.date }),
      })
      await supabase.from('logistics_suggestions').update({ status: 'rejected' }).eq('id', pendingSug.id)
      onUpdate(actId, field, null, pendingSug.id)
      toast('Sugestão recusada')
    } finally {
      setLoading(false)
    }
  }

  if (semLogistica) return null

  const icon = field === 'takes_user_id' ? <Car size={11} /> : <Home size={11} />
  const slotLabel = field === 'takes_user_id' ? 'LEVA' : 'BUSCA'

  // ── PENDENTE ────────────────────────────────────────────────────────────
  if (pendingSug) {
    const isForMe = pendingSug.proposed_to === currentUserId
    const isByMe  = pendingSug.proposed_by === currentUserId

    if (isForMe) {
      return (
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
            style={{ fontSize: 11, fontWeight: 600, background: 'rgba(245,158,11,0.10)', border: '1.5px solid rgba(245,158,11,0.40)', color: '#92400E' }}>
            {icon}<Clock size={10} />
            {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
            <span>{memberName(pendingSug.proposed_to)}</span>
          </div>
          <button onClick={handleAccept} disabled={loading} title="Aceitar"
            className="w-6 h-6 rounded-md flex items-center justify-center hover:brightness-105 active:scale-95"
            style={{ background: 'rgba(61,102,65,0.15)', border: '1px solid rgba(61,102,65,0.30)', cursor: 'pointer', flexShrink: 0 }}>
            <Check size={11} color="#2D6A35" />
          </button>
          <button onClick={handleReject} disabled={loading} title="Recusar"
            className="w-6 h-6 rounded-md flex items-center justify-center hover:brightness-105 active:scale-95"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer', flexShrink: 0 }}>
            <X size={11} color="#DC2626" />
          </button>
        </div>
      )
    }

    if (isByMe) {
      return (
        <button onClick={() => handleSelect(null)} disabled={loading}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:brightness-95 active:scale-95"
          style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: 'rgba(245,158,11,0.08)', border: '1.5px dashed rgba(245,158,11,0.50)', color: '#92400E' }}>
          {icon}<Clock size={10} />
          {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
          {memberName(pendingSug.proposed_to)}
        </button>
      )
    }

    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
        style={{ fontSize: 11, fontWeight: 600, cursor: 'default',
          background: 'rgba(245,158,11,0.06)', border: '1.5px solid rgba(245,158,11,0.28)', color: '#92400E' }}>
        {icon}<Clock size={10} />{memberName(pendingSug.proposed_to)}
      </div>
    )
  }

  // ── LEITURA APENAS ─────────────────────────────────────────────────────
  if (!canLogistics) {
    let s: React.CSSProperties
    const orphaned = isOrphaned(value)
    if (!value) s = { background: 'rgba(61,102,65,0.05)', border: '1.5px dashed rgba(61,102,65,0.25)', color: 'rgba(26,43,28,0.40)' }
    else if (value === currentUserId) s = { background: 'rgba(61,102,65,0.10)', border: '1.5px solid rgba(61,102,65,0.30)', color: '#2D6A35' }
    else if (orphaned) s = { background: 'rgba(107,114,128,0.08)', border: '1.5px dashed rgba(107,114,128,0.35)', color: 'rgba(26,43,28,0.45)' }
    else s = { background: 'rgba(99,102,241,0.08)', border: '1.5px solid rgba(99,102,241,0.25)', color: '#4338CA' }
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
        style={{ fontSize: 11, fontWeight: 600, cursor: 'default', ...s }}>
        {icon}
        {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
        <span>{value ? memberName(value) : '—'}</span>
      </div>
    )
  }

  // ── SLOT BLOQUEADO (confirmado por outro — não pode reatribuir) ─────────
  if (confirmedByOther && !isOwner) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
        style={{ fontSize: 11, fontWeight: 600, cursor: 'not-allowed',
          background: 'rgba(99,102,241,0.08)', border: '1.5px solid rgba(99,102,241,0.25)', color: '#4338CA' }}>
        {icon}
        {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
        {memberName(value)}
      </div>
    )
  }

  if (confirmedByOther && isOwner) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
        title="Parceiro confirmou — aguarde ele liberar"
        style={{ fontSize: 11, fontWeight: 600, cursor: 'not-allowed',
          background: 'rgba(99,102,241,0.08)', border: '1.5px solid rgba(99,102,241,0.25)', color: '#4338CA' }}>
        {icon}
        {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
        {memberName(value)}
      </div>
    )
  }

  // ── ESTILO NORMAL ─────────────────────────────────────────────────────
  const orphanedValue = isOrphaned(value)
  let chipStyle: React.CSSProperties
  if (!value) chipStyle = { background: 'rgba(61,102,65,0.05)', border: '1.5px dashed rgba(61,102,65,0.25)', color: 'rgba(26,43,28,0.40)' }
  else if (value === currentUserId) chipStyle = { background: 'rgba(61,102,65,0.10)', border: '1.5px solid rgba(61,102,65,0.30)', color: '#2D6A35' }
  else chipStyle = { background: 'rgba(99,102,241,0.08)', border: '1.5px solid rgba(99,102,241,0.25)', color: '#4338CA' }

  const suggestableMembers = familyMembers.filter(m => canSuggestTo(m.user_id))

  const dropdown = open && dropPos ? createPortal(
    <div ref={ref} className="py-1 rounded-xl shadow-xl"
      style={{
        position: 'absolute',
        top: dropPos.top, left: dropPos.left, minWidth: dropPos.width,
        zIndex: 9999,
        background: 'linear-gradient(160deg,#FFFFFF,#F8F3EA)',
        border: '1px solid rgba(61,102,65,0.18)',
        boxShadow: '0 8px 24px rgba(44,74,46,0.18)',
      }}>

      {value && (
        <button onClick={() => handleSelect(null)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-black/[0.04]"
          style={{ fontSize: 12, color: 'rgba(26,43,28,0.45)', border: 'none', background: 'none', cursor: 'pointer' }}>
          <span className="w-4 h-4 rounded-full border border-dashed flex-shrink-0" style={{ borderColor: 'rgba(61,102,65,0.35)' }} />
          Nenhum
        </button>
      )}

      <button onClick={() => handleSelect(currentUserId)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-black/[0.04]"
        style={{ fontSize: 12, fontWeight: value === currentUserId ? 700 : 500,
          color: value === currentUserId ? '#2D6A35' : '#1A2B1C',
          border: 'none', background: 'none', cursor: 'pointer' }}>
        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
          style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)' }}>V</span>
        Você {value === currentUserId && '✓'}
      </button>

      {suggestableMembers.filter(m => m.user_id !== currentUserId).map(m => (
        <button key={m.user_id} onClick={() => handleSelect(m.user_id)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-black/[0.04]"
          style={{ fontSize: 12, fontWeight: value === m.user_id ? 700 : 500,
            color: value === m.user_id ? '#4338CA' : '#1A2B1C',
            border: 'none', background: 'none', cursor: 'pointer' }}>
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(140deg,#6366f1,#4338CA)' }}>
            {(m.display_name ?? '?').charAt(0).toUpperCase()}
          </span>
          {m.display_name ?? 'Parceiro(a)'}
          {value === m.user_id ? ' ✓' : ' (sugerir)'}
        </button>
      ))}
    </div>,
    document.body
  ) : null

  // ── SLOT ÓRFÃO (ex-parceiro desconectado) — editável p/ quem tem logística ──
  // Estilo cinza tracejado deixa claro que é um vínculo de alguém que saiu;
  // o dropdown permite assumir (Você), liberar (Nenhum) ou sugerir a outro membro.
  if (orphanedValue) {
    const orphanStyle: React.CSSProperties = {
      background: 'rgba(107,114,128,0.08)',
      border: '1.5px dashed rgba(107,114,128,0.35)',
      color: 'rgba(26,43,28,0.55)',
    }
    return (
      <div className="relative">
        <button
          ref={btnRef}
          onClick={() => setOpen(o => !o)}
          disabled={loading}
          title="Ex-parceiro(a) desconectado — você pode reatribuir ou liberar este slot"
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg w-full hover:brightness-95 active:scale-95"
          style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', ...orphanStyle }}>
          {icon}
          {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
          <span className="flex-1 text-left truncate">{memberName(value)}</span>
          <ChevronDown size={9} style={{ flexShrink: 0, opacity: 0.55, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </button>
        {dropdown}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg w-full hover:brightness-95 active:scale-95"
        style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', ...chipStyle }}>
        {icon}
        {!compact && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>{slotLabel}</span>}
        <span className="flex-1 text-left truncate">
          {value ? memberName(value) : 'Definir'}
        </span>
        <ChevronDown size={9} style={{ flexShrink: 0, opacity: 0.55, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {dropdown}
    </div>
  )
}
