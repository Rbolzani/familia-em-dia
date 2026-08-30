'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Child } from '@/lib/types'
import { avatarPath, signChildAvatars } from '@/lib/avatars'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { Plus, Pencil, Trash2, GraduationCap, Cake, Camera, X, AlertCircle, Check, Lock } from 'lucide-react'
import type { PlanId } from '@/lib/billing'
import EmptyState from '@/components/ui/EmptyState'
import { useAccess } from '@/components/access/AccessContext'
import FamilySwitcher, { type FamilyOption } from '@/components/layout/FamilySwitcher'

// Stable singleton — not re-created on every render
const supabase = createClient()

const AVATAR_COLORS = [
  '#F4522D','#F5A623','#00C48C','#2563EB',
  '#7C3AED','#DB2777','#0891B2','#059669',
]

function calcAge(birthDate: string | null) {
  if (!birthDate) return null
  const diff = Date.now() - new Date(birthDate + 'T00:00:00').getTime()
  const years = Math.floor(diff / (365.25 * 86_400_000))
  return years > 0 ? `${years} anos` : 'Menos de 1 ano'
}

// ── Avatar component — shows photo or letter fallback ─────────────────────
export function ChildAvatar({
  child, size = 56, radius = 18,
}: { child: Pick<Child,'name'|'avatar_color'|'avatar_url'>; size?: number; radius?: number }) {
  const [imgError, setImgError] = useState(false)
  const showPhoto = child.avatar_url && !imgError

  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden',
      background: showPhoto ? 'transparent' : child.avatar_color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 6px 20px ${child.avatar_color}55`,
      fontFamily: 'var(--font-lora)', fontWeight: 700,
      fontSize: size * 0.38, color: 'white',
    }}>
      {showPhoto ? (
        <img src={child.avatar_url!} alt={child.name}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        child.name.charAt(0).toUpperCase()
      )}
    </div>
  )
}

// ── Photo picker ──────────────────────────────────────────────────────────
// Uses <label htmlFor> → <input> association: the most universally supported
// way to trigger a file picker on mobile without programmatic .click() calls.
// Image rendered as <img src={blobUrl}> inside the label — not backgroundImage,
// not inside a <button> — the combination that works on all Android/iOS browsers.
function PhotoPicker({ preview, onFile, onClear }: {
  preview: string | null
  onFile: (f: File) => void
  onClear: () => void
}) {
  const inputId = 'child-photo-input'

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) onFile(f)
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>

      {/* label triggers the file input natively — no .click() needed, works on all mobile */}
      <label
        htmlFor={inputId}
        style={{
          width: 88, height: 88, borderRadius: 20, flexShrink: 0,
          cursor: 'pointer', position: 'relative', overflow: 'hidden',
          display: 'block',
          background: 'rgba(61,102,65,0.07)',
          border: preview ? '2px solid rgba(61,102,65,0.20)' : '2px dashed rgba(61,102,65,0.35)',
        }}>
        {/* img inside label — renders blob URL reliably on all browsers */}
        {preview && (
          <img
            src={preview}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover', display: 'block',
            }}
          />
        )}
        {/* Camera overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: preview ? 'rgba(0,0,0,0.28)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Camera size={preview ? 18 : 28} color={preview ? 'white' : 'rgba(61,102,65,0.50)'} />
        </div>
      </label>

      {/* File input — display:none is fine when triggered via label htmlFor */}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleChange}
      />

      {/* Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <label
          htmlFor={inputId}
          style={{
            padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(61,102,65,0.10)', color: '#3D6641',
            border: '1px solid rgba(61,102,65,0.22)',
            fontSize: 13, fontWeight: 700, display: 'block', textAlign: 'center',
          }}>
          {preview ? '📷 Trocar foto' : '📷 Escolher foto'}
        </label>

        {preview && (
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: '7px 16px', borderRadius: 10, cursor: 'pointer',
              background: 'rgba(220,38,38,0.07)', color: '#DC2626',
              border: '1px solid rgba(220,38,38,0.18)',
              fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            <X size={11} /> Remover foto
          </button>
        )}

        <p style={{ fontSize: 11, color: 'rgba(26,43,28,0.35)', margin: 0 }}>
          JPG, PNG, WEBP • máx 5 MB
        </p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
interface Props {
  initialChildren: Child[]
  families: FamilyOption[]
  familyId: string | null
  familyCurrentName: string | null
  isOwner: boolean
  plan: PlanId
  childLimit: number
}

export default function ChildrenClient({ initialChildren, families, familyId, familyCurrentName, isOwner, plan, childLimit }: Props) {
  const { canEdit } = useAccess()
  const [children,     setChildren]     = useState<Child[]>(initialChildren)
  useEffect(() => { setChildren(initialChildren) }, [initialChildren])
  const [familyName,   setFamilyName]   = useState(familyCurrentName ?? '')
  const [editingName,  setEditingName]  = useState(false)
  const [savingName,   setSavingName]   = useState(false)
  const [nameSaved,    setNameSaved]    = useState(false)
  useEffect(() => { setFamilyName(familyCurrentName ?? '') }, [familyCurrentName])
  const [modal,        setModal]        = useState<{ mode:'new'|'edit'; child?: Child }|null>(null)
  const [showUpgrade,  setShowUpgrade]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState<string|null>(null)
  const [deleteError,  setDeleteError]  = useState<string|null>(null)
  const [deleting,     setDeleting]     = useState<string|null>(null)   // id being deleted
  const [form,         setForm]         = useState({
    name: '', birth_date: '', school_name: '', avatar_color: AVATAR_COLORS[0],
  })
  const [photoFile,    setPhotoFile]    = useState<File|null>(null)
  const [photoPreview, setPhotoPreview] = useState<string|null>(null)

  // Track current blob URL so we can revoke it when replaced or unmounted
  const blobUrlRef = useRef<string | null>(null)

  function revokeBlobUrl() {
    if (blobUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }

  // Revoke on unmount
  useEffect(() => revokeBlobUrl, [])

  const closeModal = useCallback(() => {
    revokeBlobUrl()
    setModal(null)
    setSaveError(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const { data } = await supabase.from('children').select('*').order('sort_order')
    // Reassina no cliente: a query devolve só `avatar_path`, e o <img> precisa
    // da URL com token. Sem isto a foto some depois de salvar ou excluir.
    setChildren(await signChildAvatars(supabase, data ?? []))
  }

  const atChildLimit = childLimit !== Infinity && children.length >= childLimit

  function openNew() {
    if (atChildLimit) { setShowUpgrade(true); return }
    setForm({ name: '', birth_date: '', school_name: '', avatar_color: AVATAR_COLORS[0] })
    setPhotoFile(null)
    setPhotoPreview(null)
    setSaveError(null)
    setModal({ mode: 'new' })
  }

  function openEdit(child: Child) {
    setForm({
      name: child.name,
      birth_date: child.birth_date ?? '',
      school_name: child.school_name ?? '',
      avatar_color: child.avatar_color,
    })
    setPhotoFile(null)
    setPhotoPreview(child.avatar_url ?? null)
    setSaveError(null)
    setModal({ mode: 'edit', child })
  }

  function handleFileSelected(f: File) {
    setPhotoFile(f)
    // Revoke previous blob URL before creating a new one
    revokeBlobUrl()
    const blobUrl = URL.createObjectURL(f)
    blobUrlRef.current = blobUrl
    setPhotoPreview(blobUrl)
  }

  /**
   * Sobe a foto e devolve o CAMINHO — não uma URL.
   *
   * O caminho é `<family_id>/<child_id>.<ext>`: a foto pertence à família, não
   * a quem subiu. Antes era `<user_id>/<child_id>_<timestamp>.<ext>`, o que
   * fazia a foto sumir quando quem subiu saía da família, e impedia a exclusão
   * de conta de limpá-la sem destruir dado de quem ficava.
   *
   * Sem timestamp no nome: `upsert: true` substitui a foto anterior em vez de
   * acumular um arquivo órfão por troca de foto.
   */
  async function uploadPhoto(famId: string, childId: string): Promise<string | null> {
    if (!photoFile) return null

    const ext  = photoFile.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = avatarPath(famId, childId, ext)

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, photoFile, { upsert: true })

    if (uploadError) {
      console.error('[uploadPhoto] storage error:', uploadError)
      throw new Error(`Erro no upload da foto: ${uploadError.message}`)
    }

    return path
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setSaveError(null)

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr || !user) throw new Error('Sessão expirada. Faça login novamente.')
      // A pasta da foto é a família — sem ela não há onde gravar.
      if (photoFile && !familyId) throw new Error('Família não identificada. Recarregue a página.')

      const baseFields = {
        name:         form.name.trim(),
        birth_date:   form.birth_date || null,
        school_name:  form.school_name.trim() || null,
        avatar_color: form.avatar_color,
      }

      if (modal?.mode === 'new') {
        // Criar filho via API (admin client — sem RLS)
        const res = await fetch('/api/children', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...baseFields, sort_order: children.length }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(`Erro ao cadastrar filho: ${json.error}`)

        // Upload foto e atualizar via API
        if (photoFile) {
          const path = await uploadPhoto(familyId!, json.child.id)
          if (path) {
            await fetch('/api/children', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: json.child.id, ...baseFields, avatar_path: path }),
            })
          }
        }

      } else {
        const child = modal!.child!
        let avatarPathNovo: string | null | undefined = undefined

        if (photoFile) {
          avatarPathNovo = await uploadPhoto(familyId!, child.id)
        } else if (photoPreview === null && child.avatar_path) {
          // Removeu a foto: apaga o arquivo além de limpar a coluna, senão
          // sobra imagem de criança no bucket sem nada apontando para ela.
          await supabase.storage.from('avatars').remove([child.avatar_path])
          avatarPathNovo = null
        }

        const res = await fetch('/api/children', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: child.id, ...baseFields, avatar_path: avatarPathNovo }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(`Erro ao salvar filho: ${json.error}`)
      }

      await load()
      closeModal()

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.'
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remover ${name}? As atividades associadas também serão removidas.`)) return
    setDeleteError(null)
    setDeleting(id)
    try {
      const res = await fetch(`/api/children?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        setDeleteError(`Não foi possível excluir "${name}": ${json.error}`)
      } else {
        await load()
      }
    } catch (err) {
      setDeleteError(`Erro inesperado ao excluir "${name}". Tente novamente.`)
    } finally {
      setDeleting(null)
    }
  }

  async function saveFamilyName() {
    if (!familyId || !familyName.trim()) return
    setSavingName(true)
    const { error } = await supabase.from('families').update({ name: familyName.trim() }).eq('id', familyId)
    setSavingName(false)
    if (!error) { setEditingName(false); setNameSaved(true); setTimeout(() => setNameSaved(false), 2500) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between animate-fade-up">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#3D6641' }}>Perfis</p>
          <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 30, fontWeight: 700, color: '#1A2B1C', lineHeight: 1.1 }}>
            Meus Filhos
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(26,43,28,0.45)' }}>
            {children.length > 0
              ? `${children.length} filho${children.length > 1 ? 's' : ''} cadastrado${children.length > 1 ? 's' : ''}`
              : 'Adicione os perfis dos seus filhos'}
          </p>
        </div>
        {canEdit && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all hover:brightness-105 active:scale-95"
            style={{
              background: atChildLimit ? 'rgba(61,102,65,0.12)' : 'linear-gradient(140deg,#FF8A6E,#FF6B5C)',
              color: atChildLimit ? '#3D6641' : 'white',
              boxShadow: atChildLimit ? 'none' : '0 4px 16px rgba(255,107,92,0.32)',
            }}>
            {atChildLimit ? <Lock size={14} /> : <Plus size={16} />}
            {atChildLimit ? 'Limite atingido' : 'Adicionar'}
          </button>
        )}
      </div>

      {/* Conta / família ativa */}
      <div className="animate-fade-up rounded-2xl overflow-hidden"
        style={{ background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.14)' }}>

        {/* Linha: seletor de conta */}
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,43,28,0.55)' }}>
            Conta ativa:
          </span>
          <FamilySwitcher families={families} />
        </div>

        {/* Linha: nome da família (só para owner) */}
        {isOwner && familyId && (
          <div style={{ borderTop: '1px solid rgba(61,102,65,0.10)' }} className="px-3 py-3">
            {editingName ? (
              <div className="flex gap-2 items-center">
                <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,43,28,0.55)', flexShrink: 0 }}>
                  Nome:
                </span>
                <input
                  autoFocus
                  value={familyName}
                  onChange={e => setFamilyName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveFamilyName(); if (e.key === 'Escape') { setEditingName(false); setFamilyName(familyCurrentName ?? '') } }}
                  placeholder="Ex.: Família Souza"
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1.5px solid rgba(61,102,65,0.35)', fontSize: 13, color: '#1A2B1C', outline: 'none', background: '#fff' }}
                />
                <button onClick={saveFamilyName} disabled={savingName}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:brightness-105 disabled:opacity-60"
                  style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                  <Check size={13} color="#fff" />
                </button>
                <button onClick={() => { setEditingName(false); setFamilyName(familyCurrentName ?? '') }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                  style={{ border: '1px solid rgba(61,102,65,0.20)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}>
                  <X size={13} color="rgba(26,43,28,0.45)" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,43,28,0.55)' }}>Nome da família:</span>
                <div className="flex items-center gap-2">
                  {nameSaved && <span style={{ fontSize: 11, color: '#2D6A35', fontWeight: 600 }}>✓ Salvo</span>}
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1A2B1C' }}>{familyName || 'Minha Família'}</span>
                  <button onClick={() => setEditingName(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all hover:brightness-105"
                    style={{ background: 'rgba(61,102,65,0.10)', color: '#2D6A35', border: 'none', cursor: 'pointer' }}>
                    <Pencil size={11} /> Renomear
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upgrade banner — limite de filhos atingido */}
      {showUpgrade && (
        <div className="animate-fade-up rounded-2xl p-4" style={{
          background: 'linear-gradient(135deg,rgba(196,154,108,0.12),rgba(61,102,65,0.08))',
          border: '1px solid rgba(196,154,108,0.35)',
        }}>
          <div className="flex items-start gap-3">
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(140deg,#C49A6C,#A07848)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Lock size={16} color="white" />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#1A2B1C', margin: '0 0 4px' }}>
                Limite de {childLimit} filho{childLimit > 1 ? 's' : ''} atingido
              </p>
              <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.60)', margin: '0 0 12px', lineHeight: 1.5 }}>
                {plan === 'free'
                  ? 'O plano Gratuito permite 1 filho. Faça upgrade para o plano Família (2 filhos) ou Plus (ilimitado).'
                  : 'O plano Família permite até 2 filhos. Faça upgrade para o Plus e adicione filhos ilimitados.'}
              </p>
              <a href="/planos"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(140deg,#C49A6C,#A07848)', textDecoration: 'none' }}>
                Ver planos →
              </a>
            </div>
            <button onClick={() => setShowUpgrade(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(26,43,28,0.40)', flexShrink: 0 }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Delete error banner */}
      {deleteError && (
        <div className="animate-fade-up" style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '14px 16px', borderRadius: 14,
          background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.22)',
        }}>
          <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{deleteError}</p>
          </div>
          <button onClick={() => setDeleteError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#DC2626', flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Empty state */}
      {children.length === 0 && (
        <EmptyState
          title="Comece pela parte boa"
          subtitle="Cadastre seu primeiro filho para começar a organizar a rotina da família."
          actionLabel={canEdit ? '+ Adicionar filho' : undefined}
          onAction={canEdit ? openNew : undefined}
          showIaShortcut={false}
        />
      )}

      {/* Lista — mobile: bolinhas lado a lado (toque para editar/excluir) */}
      {children.length > 0 && (
        <div className="md:hidden">
          <div className="grid grid-cols-3 gap-x-2 gap-y-5 mt-1">
            {children.map(child => (
              <button key={child.id} onClick={() => canEdit && openEdit(child)}
                className="flex flex-col items-center"
                style={{ background:'none', border:'none', padding:0, cursor: canEdit ? 'pointer' : 'default' }}>
                <ChildAvatar child={child} size={62} radius={31} />
                <span style={{ fontSize:12, fontWeight:600, color:'#1A2B1C', marginTop:6, maxWidth:84, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {child.name}
                </span>
              </button>
            ))}
            {canEdit && (
              <button onClick={openNew} className="flex flex-col items-center"
                style={{ background:'none', border:'none', padding:0, cursor:'pointer' }}>
                <div style={{ width:62, height:62, borderRadius:'50%', border:'1.5px dashed rgba(61,102,65,0.35)',
                  display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(61,102,65,0.55)' }}>
                  <Plus size={24} />
                </div>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(26,43,28,0.45)', marginTop:6 }}>Novo</span>
              </button>
            )}
          </div>
          <p className="text-xs text-center mt-4" style={{ color:'rgba(26,43,28,0.40)' }}>
            Toque numa bolinha para editar ou excluir
          </p>
        </div>
      )}

      {/* Lista — desktop: cards de gestão */}
      {children.length > 0 && (
        <div className="space-y-3 stagger hidden md:block">
          {children.map((child, i) => (
            <div key={child.id}
              className="card card-lift animate-fade-up p-4 flex items-center gap-4"
              style={{ animationDelay: `${i * 0.06}s` }}>

              <ChildAvatar child={child} size={56} radius={16} />

              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B1C' }}>{child.name}</div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {child.birth_date && (
                    <span className="text-xs flex items-center gap-1 font-medium" style={{ color: 'rgba(26,43,28,0.50)' }}>
                      <Cake size={12} /> {calcAge(child.birth_date)}
                    </span>
                  )}
                  {child.school_name && (
                    <span className="text-xs flex items-center gap-1 font-medium" style={{ color: 'rgba(26,43,28,0.50)' }}>
                      <GraduationCap size={12} /> {child.school_name}
                    </span>
                  )}
                  {!child.birth_date && !child.school_name && (
                    <span className="text-xs italic" style={{ color: 'rgba(26,43,28,0.30)' }}>Sem informações adicionais</span>
                  )}
                </div>
              </div>

              {canEdit && (
                <div className="flex gap-1.5 flex-none">
                  <button onClick={() => openEdit(child)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                    style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => handleDelete(child.id, child.name)}
                    disabled={deleting === child.id}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                    style={{
                      background: 'rgba(220,38,38,0.08)', color: '#DC2626',
                      opacity: deleting === child.id ? 0.5 : 1,
                      cursor: deleting === child.id ? 'wait' : 'pointer',
                    }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal open={!!modal} onClose={closeModal}
        title={modal?.mode === 'new' ? '👶 Adicionar filho' : '✏️ Editar filho'} size="sm">
        <div className="space-y-5">

          {/* Error banner */}
          {saveError && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '12px 14px', borderRadius: 12,
              background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.22)',
            }}>
              <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.45, margin: 0 }}>{saveError}</p>
            </div>
          )}

          {/* Photo picker */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(26,43,28,0.55)' }}>
              Foto
            </label>
            <PhotoPicker
              preview={photoPreview}
              onFile={handleFileSelected}
              onClear={() => { revokeBlobUrl(); setPhotoFile(null); setPhotoPreview(null) }}
            />
          </div>

          {/* Name */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(26,43,28,0.55)' }}>
              Nome *
            </label>
            <input type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Nome do filho(a)" className="input-field w-full" />
          </div>

          {/* Birth date */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(26,43,28,0.55)' }}>
              Data de nascimento
            </label>
            <input type="date" value={form.birth_date}
              onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))}
              className="input-field w-full" />
          </div>

          {/* School */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(26,43,28,0.55)' }}>
              Escola
            </label>
            <input type="text" value={form.school_name}
              onChange={e => setForm(f => ({ ...f, school_name: e.target.value }))}
              placeholder="Nome da escola" className="input-field w-full" />
          </div>

          {/* Avatar color */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(26,43,28,0.55)' }}>
              Cor do avatar
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {AVATAR_COLORS.map(color => (
                <button key={color} type="button"
                  onClick={() => setForm(f => ({ ...f, avatar_color: color }))}
                  style={{
                    width: 36, height: 36, borderRadius: 10, background: color,
                    border: 'none', cursor: 'pointer',
                    boxShadow: form.avatar_color === color
                      ? `0 0 0 3px white, 0 0 0 5px ${color}`
                      : '0 2px 6px rgba(0,0,0,0.15)',
                    transform: form.avatar_color === color ? 'scale(1.15)' : 'scale(1)',
                    transition: 'all .18s',
                  }} />
              ))}
            </div>

            {/* Avatar preview */}
            <div style={{
              marginTop: 12, display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 14, background: 'rgba(61,102,65,0.06)',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 13, overflow: 'hidden', flexShrink: 0,
                background: form.avatar_color,
                backgroundImage: photoPreview ? `url("${photoPreview}")` : 'none',
                backgroundSize: 'cover', backgroundPosition: 'center',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-lora)', fontWeight: 700, fontSize: 18, color: 'white',
              }}>
                {!photoPreview && (form.name.charAt(0).toUpperCase() || '?')}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1A2B1C' }}>
                {form.name || 'Nome do filho'}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <Button variant="ghost" onClick={closeModal} style={{ flex: 1 }}>
              Cancelar
            </Button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              style={{
                flex: 2, padding: '13px 20px', borderRadius: 14, border: 'none',
                cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
                background: saving || !form.name.trim()
                  ? 'rgba(61,102,65,0.25)'
                  : 'linear-gradient(140deg,#FF8A6E,#FF6B5C)',
                color: 'white', fontSize: 15, fontWeight: 700,
                boxShadow: saving || !form.name.trim() ? 'none' : '0 4px 16px rgba(255,107,92,0.32)',
                transition: 'all .2s',
              }}>
              {saving
                ? 'Salvando…'
                : modal?.mode === 'new'
                  ? '✓ Adicionar filho'
                  : '✓ Salvar alterações'}
            </button>
          </div>

          {modal?.mode === 'edit' && canEdit && modal.child && (
            <button
              onClick={async () => { const c = modal.child!; await handleDelete(c.id, c.name); closeModal() }}
              style={{ marginTop: 12, width: '100%', background: 'none', border: 'none',
                color: '#DC2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px' }}>
              Excluir filho
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}
