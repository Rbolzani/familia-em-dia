'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Activity, ActivityCategory, Child, SchoolKind, SCHOOL_KIND_LABELS } from '@/lib/types'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { DeadlineBadge } from '@/components/ui/Badge'
import { Plus, Trash2, Pencil, Filter, Clock, MapPin, Sparkles, ListChecks, Check, X } from 'lucide-react'
import Link from 'next/link'
import { mergeActivities } from '@/lib/merge-activities'
import { useAccess } from '@/components/access/AccessContext'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from '@/components/ui/Toast'
import EmptyState from '@/components/ui/EmptyState'
import LogChip, { LogisticsSuggestion, FamilyMemberInfo } from '@/components/activities/LogChip'

interface Props {
  category: ActivityCategory
  title: string
  emoji: string
  color: string
  subtypes?: string[]
  initialActivities?: Activity[]
  initialChildren?: Child[]
  familyMembers?: FamilyMemberInfo[]
  currentUserId?: string
  familyId?: string | null
  isOwner?: boolean
  initialSuggestions?: LogisticsSuggestion[]
}

const ALERT_OPTIONS = [
  { value: 0, label: 'No dia' },
  { value: 1, label: '1 dia antes' },
  { value: 2, label: '2 dias antes' },
  { value: 3, label: '3 dias antes' },
  { value: 5, label: '5 dias antes' },
  { value: 7, label: '1 semana antes' },
  { value: 14, label: '2 semanas antes' },
  { value: 30, label: '1 mês antes' },
]

const catGradient: Record<ActivityCategory, string> = {
  escola: 'linear-gradient(135deg,#2563EB,#1D4ED8)',
  saude: 'linear-gradient(135deg,#00C48C,#00A876)',
  extracurricular: 'linear-gradient(135deg,#7C3AED,#6D28D9)',
}
const catAccent: Record<ActivityCategory, string> = {
  escola: '#2563EB',
  saude: '#00C48C',
  extracurricular: '#7C3AED',
}
const catBg: Record<ActivityCategory, string> = {
  escola: '#EEF4FF',
  saude: '#E6FBF4',
  extracurricular: '#F3EEFF',
}

const placeholders: Record<ActivityCategory, string> = {
  escola: 'Ex.: Prova de Matemática',
  saude: 'Ex.: Consulta Pediatra',
  extracurricular: 'Ex.: Futebol',
}

const emptyForm = {
  child_id: '', title: '', description: '', date: '', time: '', alert_days: 3, location: '',
}

export default function ActivitiesPage({ category, title, emoji, color, initialActivities, initialChildren, familyMembers = [], currentUserId, familyId, isOwner = false, initialSuggestions = [] }: Props) {
  const supabase = createClient()
  const { canEdit } = useAccess()
  const [activities, setActivities] = useState<Activity[]>(initialActivities ?? [])
  const [children, setChildren] = useState<Child[]>(initialChildren ?? [])
  const [suggestions, setSuggestions] = useState<LogisticsSuggestion[]>(initialSuggestions)
  const [loading, setLoading] = useState(!initialActivities)

  useEffect(() => { setActivities(initialActivities ?? []) }, [initialActivities])
  useEffect(() => { setChildren(initialChildren ?? []) }, [initialChildren])
  useEffect(() => { setSuggestions(initialSuggestions ?? []) }, [initialSuggestions])

  // Realtime: logistics_suggestions → update chip state live
  useEffect(() => {
    if (!familyId) return
    const channel = supabase
      .channel(`suggestions_activities_${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'logistics_suggestions', filter: `family_id=eq.${familyId}` }, payload => {
        if (payload.eventType === 'INSERT') {
          setSuggestions(prev => [...prev.filter(s => s.id !== (payload.new as LogisticsSuggestion).id), payload.new as LogisticsSuggestion])
        } else if (payload.eventType === 'UPDATE') {
          setSuggestions(prev => prev.map(s => s.id === (payload.new as LogisticsSuggestion).id ? payload.new as LogisticsSuggestion : s))
        } else if (payload.eventType === 'DELETE') {
          setSuggestions(prev => prev.filter(s => s.id !== (payload.old as { id: string }).id))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [familyId])
  const [filterChild, setFilterChild] = useState('')
  // Só a aba Escola separa "atividades escolares" de "rotina de aulas".
  const isSchool = category === 'escola'
  const [filterKind, setFilterKind] = useState<SchoolKind>('atividade')
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; activity?: Activity } | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })

  const accent = catAccent[category]
  const gradient = catGradient[category]
  const bg = catBg[category]

  const load = useCallback(async () => {
    const [{ data: acts }, { data: kids }] = await Promise.all([
      supabase.from('activities')
        .select('*, child:children(name, avatar_color)')
        .eq('category', category)
        .order('date').order('time', { nullsFirst: false }),
      supabase.from('children').select('*').order('sort_order'),
    ])
    setActivities(acts ?? [])
    setChildren(kids ?? [])
    setLoading(false)
  }, [category])

  useEffect(() => { load() }, [load])

  function openNew() {
    setForm({ ...emptyForm, date: new Date().toISOString().split('T')[0], child_id: children[0]?.id ?? '' })
    setModal({ mode: 'new' })
  }

  function openEdit(a: Activity) {
    setForm({ child_id: a.child_id, title: a.title, description: a.description ?? '', date: a.date ?? '', time: a.time ?? '', alert_days: a.alert_days, location: a.location ?? '' })
    setModal({ mode: 'edit', activity: a })
  }

  async function handleSave() {
    if (!form.title.trim() || !form.child_id) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      user_id: user!.id, child_id: form.child_id, category,
      title: form.title.trim(), description: form.description.trim() || null,
      date: form.date || null, time: form.time || null, alert_days: form.alert_days,
      location: form.location.trim() || null,
      // Novo item criado na aba Escola nasce no filtro que está aberto.
      ...(isSchool ? { school_kind: filterKind } : {}),
    }
    const { error } = modal?.mode === 'new'
      ? await supabase.from('activities').insert(payload)
      : await supabase.from('activities').update(payload).eq('id', modal!.activity!.id)
    setSaving(false)
    if (error) { toast('Não foi possível salvar. Tente novamente.', 'error'); return }
    setModal(null); load()
    toast(modal?.mode === 'new' ? 'Atividade adicionada ✓' : 'Alterações salvas ✓')
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta atividade?')) return
    const { error } = await supabase.from('activities').delete().eq('id', id)
    if (error) { toast('Não foi possível excluir. Tente novamente.', 'error'); return }
    setActivities(prev => prev.filter(x => x.id !== id))
    toast('Atividade excluída')
  }

  // ── Seleção múltipla ──────────────────────────────────────────────────────
  // Existe para desfazer uma captura por IA que veio errada: uma grade de aulas
  // inteira são dezenas de linhas, e apagar uma a uma é inviável.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletingBulk, setDeletingBulk] = useState(false)

  function toggleSelect(ids: string[]) {
    setSelected(prev => {
      const next = new Set(prev)
      // O card pode agrupar vários filhos: se algum não estiver marcado,
      // o clique marca o grupo todo; só desmarca quando já está inteiro.
      const allIn = ids.every(id => next.has(id))
      ids.forEach(id => allIn ? next.delete(id) : next.add(id))
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  // Confirmação da exclusão em lote. É um modal e não um confirm() porque
  // precisa de um checkbox: a lista só mostra o que é de hoje em diante, mas o
  // calendário mostra o mês inteiro — quem apaga "todas" aqui e depois abre o
  // calendário acha que a exclusão falhou. O diálogo nomeia o que sobra.
  const [confirmBulk, setConfirmBulk] = useState<{ ids: string[]; pastIds: string[] } | null>(null)
  const [alsoPast, setAlsoPast] = useState(false)

  function handleDeleteSelected(visibleIds: string[]) {
    // Interseção com o que está na tela: nunca apagar algo que o usuário não
    // consegue ver no momento do clique.
    const ids = visibleIds.filter(id => selected.has(id))
    if (ids.length === 0) return
    // O aviso sobre o passado só faz sentido quando a seleção cobre tudo que
    // está à vista — é aí que a pessoa acha que "limpou a aba".
    const pastIds = ids.length === visibleIds.length ? pastMatchingFilter.map(a => a.id) : []
    setAlsoPast(false)
    setConfirmBulk({ ids, pastIds })
  }

  async function runBulkDelete() {
    if (!confirmBulk) return
    const ids = alsoPast ? [...confirmBulk.ids, ...confirmBulk.pastIds] : confirmBulk.ids

    setDeletingBulk(true)
    // Em lotes: um .in() com centenas de UUIDs estoura o limite de tamanho da
    // URL no PostgREST e a requisição falha inteira.
    const CHUNK = 100
    const apagados: string[] = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const lote = ids.slice(i, i + CHUNK)
      const { error } = await supabase.from('activities').delete().in('id', lote)
      if (error) {
        setActivities(prev => prev.filter(x => !apagados.includes(x.id)))
        setSelected(new Set())
        setDeletingBulk(false)
        setConfirmBulk(null)
        toast(apagados.length > 0
          ? `${apagados.length} excluída(s), mas o restante falhou. Tente de novo.`
          : 'Não foi possível excluir. Tente novamente.', 'error')
        return
      }
      apagados.push(...lote)
    }
    setActivities(prev => prev.filter(x => !apagados.includes(x.id)))
    setDeletingBulk(false)
    setConfirmBulk(null)
    exitSelectMode()
    toast(`${apagados.length} atividade${apagados.length !== 1 ? 's' : ''} excluída${apagados.length !== 1 ? 's' : ''}`)
  }

  // Trocar de filtro limpa a seleção. Sem isso o usuário selecionaria itens de
  // um filho, mudaria o filtro e apagaria coisas que saíram da tela.
  useEffect(() => { setSelected(new Set()) }, [filterChild, filterKind])

  // Today in Brazil timezone — activities before today are automatically hidden
  const todayDs = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

  const filtered = activities.filter(a => {
    if (!a.date) return false           // no date → reminders, not here
    if (a.date < todayDs) return false
    if (filterChild && a.child_id !== filterChild) return false
    // Linhas antigas não têm school_kind — NULL conta como 'atividade'.
    if (isSchool && (a.school_kind ?? 'atividade') !== filterKind) return false
    return true
  })

  // Mesmo filtro do `filtered`, mas do outro lado de hoje: é o que continua no
  // calendário depois de "excluir todas". Não aparece na lista — só no diálogo
  // de confirmação, para a pessoa decidir se apaga o histórico junto.
  const pastMatchingFilter = activities.filter(a => {
    if (!a.date) return false
    if (a.date >= todayDs) return false
    if (filterChild && a.child_id !== filterChild) return false
    if (isSchool && (a.school_kind ?? 'atividade') !== filterKind) return false
    return true
  })

  // Base da seleção: só o que está visível agora, nunca a lista inteira.
  const visibleIds = filtered.map(a => a.id)
  const selectedVisibleCount = visibleIds.filter(id => selected.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-5 space-y-5" style={{ boxSizing:'border-box' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 animate-fade-up">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold" style={{ fontFamily:'var(--font-lora)', color: '#1A2B1C' }}>{title}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(26,43,28,0.45)' }}>
            {filtered.length} próxima{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canEdit && !selectMode && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Captura com IA — apenas desktop (mobile já tem na topbar) */}
            <Link href="/ia"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all hover:brightness-105 active:scale-95"
              style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', textDecoration: 'none', boxShadow: '0 4px 14px rgba(255,107,92,0.30)' }}>
              <Sparkles size={15} /> Captura com IA
            </Link>
            <button
              onClick={openNew}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all hover:brightness-105 active:scale-95"
              style={{ background: '#fff', color: '#14463A', border: '1px solid rgba(20,70,58,0.18)', boxShadow: '0 2px 8px rgba(44,74,46,0.10)' }}
            >
              <Plus size={16} /> Nova
            </button>
          </div>
        )}
      </div>

      {/* Linha de chips (Escola) + "Selecionar" encostado à direita.
          Nas outras categorias não há chips, e a linha existe só para o botão. */}
      {(isSchool || (canEdit && !selectMode && filtered.length > 0)) && (
        <div className="flex gap-2 items-center flex-wrap animate-fade-up">
          {isSchool && (['atividade', 'aula'] as SchoolKind[]).map(k => {
            const active = filterKind === k
            const count = activities.filter(a =>
              !!a.date && a.date >= todayDs &&
              (!filterChild || a.child_id === filterChild) &&
              (a.school_kind ?? 'atividade') === k
            ).length
            return (
              <button key={k} onClick={() => setFilterKind(k)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all"
                style={active
                  ? { background:'#14463A', color:'#fff', border:'1px solid rgba(61,102,65,0.40)', boxShadow:'0 2px 8px rgba(44,74,46,0.22)' }
                  : { background:'rgba(255,255,255,0.70)', color:'rgba(26,43,28,0.50)', border:'1px solid rgba(61,102,65,0.14)' }}>
                {k === 'atividade' ? '📘' : '🕘'} {SCHOOL_KIND_LABELS[k]}
                <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                  style={active ? { background:'rgba(255,255,255,0.20)' } : { background:'rgba(26,43,28,0.06)' }}>
                  {count}
                </span>
              </button>
            )
          })}

          {canEdit && !selectMode && filtered.length > 0 && (
            <button
              onClick={() => setSelectMode(true)}
              title="Selecionar várias para excluir"
              className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all hover:brightness-105 active:scale-95"
              style={{ background: 'rgba(255,255,255,0.70)', color: 'rgba(26,43,28,0.50)', border: '1px solid rgba(61,102,65,0.14)' }}>
              <ListChecks size={14} /> Selecionar
            </button>
          )}
        </div>
      )}

      {/* Filter bar — child selector only */}
      {children.length > 1 && (
        <div className="card p-3 flex gap-2 items-center animate-fade-up">
          <Filter size={13} style={{ color: 'rgba(26,43,28,0.45)', flexShrink:0 }} />
          <select
            value={filterChild}
            onChange={e => setFilterChild(e.target.value)}
            className="text-xs font-semibold border rounded-xl px-2 py-1.5 focus:outline-none transition-colors min-w-0"
            style={{ borderColor: 'rgba(61,102,65,0.22)', color: '#1A2B1C', background: '#FDF8F2', maxWidth: 160 }}
          >
            <option value="">Todos os filhos</option>
            {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="ml-auto text-xs font-semibold flex-shrink-0" style={{ color: 'rgba(26,43,28,0.45)' }}>
            {filtered.length}
          </span>
        </div>
      )}

      {/* Barra de seleção múltipla — sticky para o botão excluir seguir o scroll
          numa lista longa (que é justamente o caso de uso). */}
      {selectMode && (
        <div className="sticky top-2 z-20 rounded-2xl p-2.5 flex items-center gap-2 flex-wrap animate-fade-up"
          style={{ background: 'linear-gradient(140deg,#14463A,#0F3830)', boxShadow: '0 6px 20px rgba(20,70,58,0.30)' }}>
          <button onClick={exitSelectMode}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all hover:brightness-125 active:scale-95"
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }} title="Sair da seleção">
            <X size={15} />
          </button>

          <span className="text-sm font-bold flex-shrink-0" style={{ color: '#fff' }}>
            {selectedVisibleCount === 0
              ? 'Selecione as atividades'
              : `${selectedVisibleCount} selecionada${selectedVisibleCount !== 1 ? 's' : ''}`}
          </span>

          <button
            onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:brightness-125 active:scale-95 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
            {allVisibleSelected ? 'Limpar' : `Selecionar todas (${visibleIds.length})`}
          </button>

          <button
            onClick={() => handleDeleteSelected(visibleIds)}
            disabled={selectedVisibleCount === 0 || deletingBulk}
            className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex-shrink-0"
            style={selectedVisibleCount === 0 || deletingBulk
              ? { background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.40)', cursor: 'not-allowed' }
              : { background: '#F4522D', color: '#fff', boxShadow: '0 3px 12px rgba(244,82,45,0.40)' }}>
            <Trash2 size={13} />
            {deletingBulk ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card h-20 shimmer" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Tudo tranquilo por aqui"
          subtitle={`${isSchool
            ? `Nada em “${SCHOOL_KIND_LABELS[filterKind]}”.`
            : `Nenhuma atividade de ${title.toLowerCase()} agendada.`}${canEdit ? ' Use “+ Nova” ou “Captura com IA” no topo para adicionar — a IA extrai tudo sozinha.' : ''}`}
        />
      ) : (
        <div className="space-y-2.5 stagger">
          {mergeActivities(filtered).map((group, gi) => (
            <ActivityCard
              key={group[0].id}
              group={group}
              accent={accent}
              index={gi}
              selectMode={selectMode}
              selectedIds={selected}
              onToggleSelect={toggleSelect}
              onEdit={(a) => openEdit(a)}
              onDelete={(id) => handleDelete(id)}
              onLogisticsUpdate={(actId, field, val, removeSugId) => {
                setActivities(prev => prev.map(a => a.id === actId ? { ...a, [field]: val } : a))
                if (removeSugId) setSuggestions(prev => prev.filter(s => s.id !== removeSugId))
              }}
              onSuggestionCreated={sug => setSuggestions(prev => [...prev.filter(s => s.id !== sug.id), sug])}
              familyMembers={familyMembers}
              currentUserId={currentUserId}
              familyId={familyId ?? null}
              isOwner={isOwner}
              suggestions={suggestions}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'new' ? `${emoji} Nova ${title}` : `✏️ Editar atividade`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
              Filho(a) *
            </label>
            <select
              value={form.child_id}
              onChange={e => setForm(f => ({ ...f, child_id: e.target.value }))}
              className="input-field w-full"
            >
              <option value="">Selecione...</option>
              {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
              Título *
            </label>
            <input
              type="text" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={placeholders[category]}
              className="input-field w-full"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
                Data <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0 }}>(opcional)</span>
              </label>
              <input
                type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="input-field w-full"
              />
              {!form.date && (
                <p className="text-[11px] mt-1 italic" style={{ color:'rgba(146,64,14,0.70)' }}>
                  Sem data → vai para Lembretes no dashboard
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
                Hora
              </label>
              <input
                type="time" value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                className="input-field w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
              Local / Observações
            </label>
            <input
              type="text" value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="Ex.: Dr. Silva — Clínica ABC"
              className="input-field w-full"
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
              Notas
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Anotações adicionais..."
              className="input-field w-full resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#0F1F3D' }}>
              Avisar com antecedência
            </label>
            <select
              value={form.alert_days}
              onChange={e => setForm(f => ({ ...f, alert_days: Number(e.target.value) }))}
              className="input-field w-full"
            >
              {ALERT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.title.trim() || !form.child_id}
              style={{ background: gradient, boxShadow: `0 4px 14px ${accent}44` }}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmação da exclusão em lote */}
      <Modal
        open={!!confirmBulk}
        onClose={() => { if (!deletingBulk) setConfirmBulk(null) }}
        title="Excluir atividades"
        size="sm"
      >
        {confirmBulk && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: '#1A2B1C' }}>
              Excluir <strong>{confirmBulk.ids.length}</strong>{' '}
              {confirmBulk.ids.length === 1 ? 'atividade' : 'atividades'} de hoje em diante?
              Esta ação não pode ser desfeita.
            </p>

            {confirmBulk.pastIds.length > 0 && (
              <label
                className="flex items-start gap-2.5 p-3 rounded-2xl cursor-pointer"
                style={{ background: 'rgba(244,82,45,0.06)', border: '1px solid rgba(244,82,45,0.20)' }}
              >
                <input
                  type="checkbox"
                  checked={alsoPast}
                  onChange={e => setAlsoPast(e.target.checked)}
                  className="mt-0.5 flex-none"
                  style={{ accentColor: '#F4522D', width: 16, height: 16 }}
                />
                <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.75)' }}>
                  Existem também <strong>{confirmBulk.pastIds.length}</strong>{' '}
                  {confirmBulk.pastIds.length === 1 ? 'atividade anterior' : 'atividades anteriores'} a hoje,
                  que não aparecem nesta lista mas <strong>continuam no calendário</strong>.
                  Marque para excluir o histórico também.
                </span>
              </label>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="ghost" onClick={() => setConfirmBulk(null)} disabled={deletingBulk}>
                Cancelar
              </Button>
              <Button
                onClick={runBulkDelete}
                disabled={deletingBulk}
                style={{ background: 'linear-gradient(140deg,#F4522D,#D93E1C)', boxShadow: '0 4px 14px rgba(244,82,45,0.35)' }}
              >
                {deletingBulk
                  ? 'Excluindo...'
                  : `Excluir ${confirmBulk.ids.length + (alsoPast ? confirmBulk.pastIds.length : 0)}`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

type ActivityWithChild = Activity & {
  child?: { name: string; avatar_color: string }
  takes_user_id?: string | null
  picks_user_id?: string | null
}

function ActivityCard({
  group, index, onEdit, onDelete, onLogisticsUpdate, onSuggestionCreated, familyMembers = [], currentUserId, familyId, isOwner, suggestions,
  selectMode = false, selectedIds, onToggleSelect,
}: {
  group: ActivityWithChild[]
  accent: string
  index: number
  selectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (ids: string[]) => void
  onEdit: (a: ActivityWithChild) => void
  onDelete: (id: string) => void
  onLogisticsUpdate: (actId: string, field: 'takes_user_id' | 'picks_user_id', value: string | null, removeSugId?: string) => void
  onSuggestionCreated?: (sug: LogisticsSuggestion) => void
  familyMembers?: FamilyMemberInfo[]
  currentUserId?: string
  familyId?: string | null
  isOwner?: boolean
  suggestions?: LogisticsSuggestion[]
}) {
  const { canEdit } = useAccess()
  const first  = group[0]
  const merged = group.length > 1
  const fmtDate = (d: string | null) => d ? format(new Date(d + 'T00:00:00'), "dd/MM/yyyy", { locale: ptBR }) : '—'

  // Em modo seleção a logística sai de cena: os chips são interativos e
  // competiriam com o clique que marca o card.
  const showLogistics = !selectMode && !!first.date && familyMembers.length > 0 && !!currentUserId

  const ids = group.map(a => a.id)
  const selCount = selectedIds ? ids.filter(id => selectedIds.has(id)).length : 0
  const allSel   = selCount === ids.length && selCount > 0
  const someSel  = selCount > 0 && !allSel

  return (
    <div
      className={`card animate-fade-up p-4${selectMode ? ' cursor-pointer' : ' card-lift'}`}
      onClick={selectMode ? () => onToggleSelect?.(ids) : undefined}
      style={{
        animationDelay: `${index * 0.04}s`,
        ...(allSel || someSel
          ? { outline: '2px solid #14463A', outlineOffset: -1, background: 'rgba(20,70,58,0.05)' }
          : {}),
      }}
    >
      <div className="flex items-start gap-3">
        {selectMode && (
          <button
            type="button"
            aria-label={allSel ? 'Desmarcar' : 'Marcar'}
            className="w-[22px] h-[22px] rounded-lg flex items-center justify-center flex-none mt-0.5 transition-all"
            style={allSel || someSel
              ? { background: '#14463A', border: '2px solid #14463A', color: '#fff' }
              : { background: '#fff', border: '2px solid rgba(26,43,28,0.25)' }}>
            {allSel && <Check size={13} strokeWidth={3.5} />}
            {/* Grupo com vários filhos parcialmente marcado */}
            {someSel && <span style={{ width: 9, height: 2.5, background: '#fff', borderRadius: 2 }} />}
          </button>
        )}
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm" style={{ color: '#0F1F3D' }}>
            {first.title}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {group.map(a => a.child && (
              <span key={a.id} className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ background: a.child.avatar_color }}>
                {a.child.name}
              </span>
            ))}
            <span className="text-xs font-medium" style={{ color: '#8B7A68' }}>
              📅 {fmtDate(first.date)}
            </span>
            {first.time && (
              <span className="text-xs flex items-center gap-1" style={{ color: '#8B7A68' }}>
                <Clock size={11} /> {first.time.slice(0,5)}
              </span>
            )}
            <DeadlineBadge date={first.date} />
          </div>
          {first.location && (
            <p className="text-xs flex items-center gap-1 mt-1" style={{ color: '#8B7A68' }}>
              <MapPin size={11} /> {first.location}
            </p>
          )}
          {first.description && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: '#C4B5A5' }}>{first.description}</p>
          )}

          {/* Logistics chips — one row per activity in group */}
          {showLogistics && (
            <div className="mt-2.5 pt-2 space-y-1.5" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              {group.map(a => (
                <div key={a.id} className="flex gap-2">
                  {merged && a.child && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white flex-shrink-0 self-center"
                      style={{ background: a.child.avatar_color }}>
                      {a.child.name}
                    </span>
                  )}
                  <div className="flex gap-1.5 flex-1">
                    <LogChip
                      actId={a.id}
                      field="takes_user_id"
                      value={a.takes_user_id ?? null}
                      activity={{ id: a.id, title: a.title, date: a.date }}
                      suggestions={suggestions ?? []}
                      familyMembers={familyMembers}
                      currentUserId={currentUserId!}
                      familyId={familyId ?? null}
                      isOwner={isOwner ?? false}
                      onUpdate={(actId, field, val, removeSugId) => onLogisticsUpdate(actId, field, val, removeSugId)}
                      onSuggestionCreated={onSuggestionCreated}
                      compact
                    />
                    <LogChip
                      actId={a.id}
                      field="picks_user_id"
                      value={a.picks_user_id ?? null}
                      activity={{ id: a.id, title: a.title, date: a.date }}
                      suggestions={suggestions ?? []}
                      familyMembers={familyMembers}
                      currentUserId={currentUserId!}
                      familyId={familyId ?? null}
                      isOwner={isOwner ?? false}
                      onUpdate={(actId, field, val, removeSugId) => onLogisticsUpdate(actId, field, val, removeSugId)}
                      onSuggestionCreated={onSuggestionCreated}
                      compact
                    />
                  </div>
                  {merged && canEdit && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => onEdit(a)}
                        className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                        style={{ background: '#EEF4FF', color: '#2563EB' }}>
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => onDelete(a.id)}
                        className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                        style={{ background: '#FFF0EB', color: '#F4522D' }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Per-child action rows when merged and NO logistics */}
          {merged && !showLogistics && canEdit && !selectMode && (
            <div className="mt-2.5 space-y-1.5 border-t pt-2" style={{ borderColor:'rgba(0,0,0,0.06)' }}>
              {group.map(a => (
                <div key={a.id} className="flex items-center gap-2">
                  {a.child && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white flex-shrink-0"
                      style={{ background: a.child.avatar_color }}>
                      {a.child.name}
                    </span>
                  )}
                  <div className="ml-auto flex gap-1 flex-shrink-0">
                    <button onClick={() => onEdit(a)}
                      className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                      style={{ background: '#EEF4FF', color: '#2563EB' }}>
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => onDelete(a.id)}
                      className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                      style={{ background: '#FFF0EB', color: '#F4522D' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions — only shown when NOT merged */}
        {!merged && canEdit && !selectMode && (
          <div className="flex gap-1.5 flex-none">
            <button onClick={() => onEdit(first)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
              style={{ background: '#EEF4FF', color: '#2563EB' }}>
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(first.id)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
              style={{ background: '#FFF0EB', color: '#F4522D' }}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
