'use client'
import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Child, type DocumentCategory, type SchoolKind, SCHOOL_KIND_LABELS } from '@/lib/types'
import { VAULT_CATEGORIES } from '@/lib/vault'
import {
  Sparkles, Upload, FileText, Camera, Check, X, Loader2,
  Clock, MapPin, BookOpen, HeartPulse, Trophy, Plus,
  Bell, FolderLock, AlertCircle, Lock, Repeat,
} from 'lucide-react'
import { useAccess } from '@/components/access/AccessContext'
import { VoiceInputButton } from '@/components/ui/VoiceInputButton'
import { useTour } from '@/components/tour/TourContext'

// ── Design tokens ────────────────────────────────────────────────────────────
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`
const CARD: React.CSSProperties = {
  borderRadius: '17px 11px 15px 13px',
  background: `${NOISE}, linear-gradient(160deg,#FFFFFF 0%,#FAFAF7 100%)`,
  backgroundSize: '200px 200px, 100% 100%',
  border: '1px solid rgba(61,102,65,0.22)',
  boxShadow: '0 4px 16px rgba(44,74,46,0.10),0 1px 4px rgba(44,74,46,0.07),0 -1px 0 rgba(255,255,255,0.85) inset',
}

// ── Agrupamento de atividades recorrentes (grade de horário) ─────────────────
// Cada matéria recorrente vira várias linhas (uma por semana) — aqui elas
// são reagrupadas num único item visual para facilitar a revisão.
type ActivityRenderItem = { kind: 'single'; index: number } | { kind: 'group'; groupId: string; indices: number[] }

function buildActivityRenderItems(acts: ExtActivity[]): ActivityRenderItem[] {
  const items: ActivityRenderItem[] = []
  const groupPos = new Map<string, number>()
  acts.forEach((a, i) => {
    if (a.recurring && a.groupId) {
      const pos = groupPos.get(a.groupId)
      if (pos !== undefined) {
        (items[pos] as { kind: 'group'; groupId: string; indices: number[] }).indices.push(i)
      } else {
        groupPos.set(a.groupId, items.length)
        items.push({ kind: 'group', groupId: a.groupId, indices: [i] })
      }
    } else {
      items.push({ kind: 'single', index: i })
    }
  })
  return items
}

const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
function weekdayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return WEEKDAY_LABELS[d.getDay()]
}
function fmtDateBR(dateStr: string): string {
  return dateStr.split('-').reverse().join('/')
}

// ── Activity categories ───────────────────────────────────────────────────────
const ACT_CONFIG = {
  escola:          { label: 'Escola',          icolor: '#2563EB', ibg: 'linear-gradient(140deg,#DBEAFE,#BFDBFE)', icon: BookOpen   },
  saude:           { label: 'Saúde',           icolor: '#065F46', ibg: 'linear-gradient(140deg,#D1FAE5,#A7F3D0)', icon: HeartPulse },
  extracurricular: { label: 'Extracurricular', icolor: '#92400E', ibg: 'linear-gradient(140deg,#FEF3C7,#FDE68A)', icon: Trophy     },
}

// ── Document categories ───────────────────────────────────────────────────────
// Derivado de VAULT_CATEGORIES (fonte única das 9 gavetas do Cofre) — evita
// esta lista ficar desatualizada em relação ao módulo Documentos.
const DOC_CONFIG = Object.fromEntries(
  VAULT_CATEGORIES.map(c => [c.key, { label: c.label, accent: c.accent, bg: c.iconBg }])
) as Record<DocumentCategory, { label: string; accent: string; bg: string }>

type ActCategory  = keyof typeof ACT_CONFIG
type DocCategory  = DocumentCategory

interface ExtActivity {
  title: string; category: ActCategory; date: string | null; time: string | null
  description: string | null; location: string | null; selected: boolean; child_ids: string[]
  recurring?: boolean; groupId?: string
}
interface ExtReminder {
  title: string; category: string; description: string | null; child_hint: string | null
  selected: boolean; child_ids: string[]
}
interface ExtDocument {
  title: string; category: DocCategory; description: string | null
  expires_at: string | null; selected: boolean; child_ids: string[]
}

export default function IAPage() {
  const access = useAccess()
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const pasteZoneRef = useRef<HTMLDivElement>(null)

  const [children, setChildren]     = useState<Child[]>([])
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([])
  const [mode, setMode]             = useState<'image' | 'text'>('image')
  const [images, setImages]         = useState<File[]>([])
  const [previews, setPreviews]     = useState<string[]>([])
  const [text, setText]             = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [pasteZoneFocused, setPasteZoneFocused] = useState(false)
  const [pasteHint, setPasteHint]   = useState(false)

  const [activities, setActivities] = useState<ExtActivity[] | null>(null)
  const [reminders, setReminders]   = useState<ExtReminder[] | null>(null)
  const [documents, setDocuments]   = useState<ExtDocument[] | null>(null)

  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  // Destino das atividades de escola na aba /escola. A IA decide a CATEGORIA
  // (escola/saúde/extra); o usuário decide se o que capturou é agenda de
  // provas/eventos ou a grade semanal de aulas.
  const [schoolKind, setSchoolKind] = useState<SchoolKind>('atividade')

  const [aiUsed,  setAiUsed]  = useState<number | null>(null)
  const [aiLimit, setAiLimit] = useState<number | null>(null)
  const [voiceBlocked, setVoiceBlocked] = useState(false)

  const hasResults = activities !== null || reminders !== null || documents !== null
  const aiBlocked  = aiLimit !== null && aiUsed !== null && aiUsed >= aiLimit

  useEffect(() => {
    supabase.from('children').select('*').order('sort_order').then(({ data }) => {
      setChildren(data ?? [])
      if (data?.[0]) setSelectedChildIds([data[0].id])
    })
    fetch('/api/billing/status').then(r => r.json()).then(d => {
      if (d.ai) { setAiUsed(d.ai.used); setAiLimit(d.ai.limit) }
      if (d.plan === 'free') setVoiceBlocked(true)
    }).catch(() => {})
  }, [])

  function toggleDefaultChild(id: string) {
    setSelectedChildIds(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
      if (next.length === 0) return prev
      if (activities) setActivities(a => a!.map(x => ({ ...x, child_ids: next })))
      if (reminders)  setReminders(r => r!.map(x => ({ ...x, child_ids: next })))
      if (documents)  setDocuments(d => d!.map(x => ({ ...x, child_ids: next })))
      return next
    })
  }

  function addFiles(files: FileList | File[]) {
    // O iOS às vezes entrega `type` vazio numa foto vinda da câmera/Arquivos —
    // aí só a extensão identifica a imagem. O servidor converte HEIC em JPEG.
    const IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']
    const arr = Array.from(files).filter(f =>
      f.type.startsWith('image/') || IMG_EXTS.includes((f.name.split('.').pop() ?? '').toLowerCase()))
    if (!arr.length) { setError('Selecione apenas imagens (PNG, JPG, WEBP, GIF, HEIC).'); return }
    setImages(prev => [...prev, ...arr])
    arr.forEach(f => setPreviews(prev => [...prev, URL.createObjectURL(f)]))
    setActivities(null); setReminders(null); setDocuments(null); setError('')
  }

  function removeImage(idx: number) {
    setImages(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleExtract() {
    setLoading(true); setError('')
    setActivities(null); setReminders(null); setDocuments(null)
    try {
      let allActs: ExtActivity[] = []
      let allRems: ExtReminder[] = []
      let allDocs: ExtDocument[] = []

      if (mode === 'image') {
        if (!images.length) { setError('Adicione pelo menos uma imagem.'); setLoading(false); return }
        for (const img of images) {
          const fd = new FormData()
          fd.append('image', img)
          const res  = await fetch('/api/ai-extract', { method: 'POST', body: fd })
          const data = await res.json()
          if (res.status === 402) {
            setAiUsed(data.used ?? aiLimit ?? 5)
            throw new Error(`Limite de ${data.limit} capturas por mês atingido. Faça upgrade para continuar.`)
          }
          if (!res.ok) throw new Error(data.error || 'Erro ao processar imagem')
          allActs = [...allActs, ...(data.activities ?? []).map((a: any) => ({ ...a, selected: true, child_ids: selectedChildIds }))]
          allRems = [...allRems, ...(data.reminders  ?? []).map((r: any) => ({ ...r, selected: true, child_ids: selectedChildIds }))]
          allDocs = [...allDocs, ...(data.documents  ?? []).map((d: any) => ({ ...d, selected: true, child_ids: selectedChildIds }))]
        }
      } else {
        if (!text.trim()) { setError('Digite algo para analisar.'); setLoading(false); return }
        const fd = new FormData()
        fd.append('text', text)
        const res  = await fetch('/api/ai-extract', { method: 'POST', body: fd })
        const data = await res.json()
        if (res.status === 402) {
          setAiUsed(data.used ?? aiLimit ?? 5)
          throw new Error(`Limite de ${data.limit} capturas por mês atingido. Faça upgrade para continuar.`)
        }
        if (!res.ok) throw new Error(data.error || 'Erro desconhecido')
        allActs = (data.activities ?? []).map((a: any) => ({ ...a, selected: true, child_ids: selectedChildIds }))
        allRems = (data.reminders  ?? []).map((r: any) => ({ ...r, selected: true, child_ids: selectedChildIds }))
        allDocs = (data.documents  ?? []).map((d: any) => ({ ...d, selected: true, child_ids: selectedChildIds }))
      }

      setActivities(allActs)
      setReminders(allRems)
      setDocuments(allDocs)
      // Atualiza contador local para feedback imediato
      if (aiLimit !== null) setAiUsed(prev => (prev ?? 0) + 1)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Não autenticado'); setSaving(false); return }

    try {
      // 1. Save activities
      const actsToSave = (activities ?? [])
        .filter(a => a.selected && a.child_ids.length > 0)
        .flatMap(a => a.child_ids.map(child_id => ({
          user_id: user.id, child_id, category: a.category,
          title: a.title, description: a.description, date: a.date ?? null,
          time: a.time, location: a.location, ai_generated: true, alert_days: 3,
          ...(a.category === 'escola' ? { school_kind: schoolKind } : {}),
        })))
      if (actsToSave.length) {
        const { error: actErr } = await supabase.from('activities').insert(actsToSave)
        if (actErr) throw new Error(`Erro ao salvar atividades: ${actErr.message}`)
      }

      // 2. Save reminders as activities with date = null (shown in dashboard reminders panel)
      const remsToSave = (reminders ?? [])
        .filter(r => r.selected && r.child_ids.length > 0)
        .flatMap(r => r.child_ids.map(child_id => ({
          user_id: user.id, child_id,
          category: r.category ?? 'extracurricular',
          title: r.title, description: r.description,
          date: null, time: null, location: null,
          ai_generated: true, alert_days: 0,
        })))
      if (remsToSave.length) {
        const { error: remErr } = await supabase.from('activities').insert(remsToSave)
        if (remErr) throw new Error(`Erro ao salvar lembretes: ${remErr.message}`)
      }

      // 3. Save documents — one per selected child (or no child if none selected)
      const docsToSave = (documents ?? []).filter(d => d.selected)
      for (const doc of docsToSave) {
        const childIds = doc.child_ids.length > 0 ? doc.child_ids : [null]
        for (const child_id of childIds) {
          const form = new FormData()
          form.append('title', doc.title)
          form.append('category', doc.category)
          if (child_id) form.append('child_id', child_id)
          if (doc.description) form.append('description', doc.description)
          if (doc.expires_at) form.append('expires_at', doc.expires_at)
          // Auto-attach scanned image if exactly 1 image uploaded
          if (mode === 'image' && images.length === 1) {
            form.append('files', images[0])
          }
          const res = await fetch('/api/documents/upload', { method: 'POST', body: form })
          if (!res.ok) {
            const json = await res.json()
            throw new Error(`Erro ao salvar documento: ${json.error}`)
          }
        }
      }

      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        setActivities(null); setReminders(null); setDocuments(null)
        setImages([]); setPreviews([]); setText('')
      }, 2500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const totalSelected =
    (activities?.filter(a => a.selected).reduce((s, a) => s + a.child_ids.length, 0) ?? 0) +
    (reminders?.filter(r => r.selected).length ?? 0) +
    (documents?.filter(d => d.selected).length ?? 0)

  // Atividade sem data = conceitualmente um lembrete (vai para o mural, não
  // para o calendário) — por isso é exibida junto de Pendências/Lembretes,
  // mesmo continuando a viver no array `activities` (data=null equivale a
  // lembrete no banco). Se o usuário adicionar uma data de volta, ela some
  // daqui e reaparece em Agenda automaticamente, já que a lista é recalculada
  // a cada render a partir do estado atual.
  const undatedActivities = (activities ?? [])
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => !a.date)
  const datedRenderItems = activities !== null
    ? buildActivityRenderItems(activities).filter(item => item.kind === 'group' || !!activities[item.index].date)
    : []

  // ── Sem permissão (partner read_only / logística) ───────────────────────────
  if (!access.canEdit) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-16">
        <div className="text-center" style={{ ...CARD, padding: '40px 28px' }}>
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-5"
            style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.20)' }}>
            <Lock size={26} style={{ color: '#4338CA' }} />
          </div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 24, fontWeight: 700, color: '#1A2B1C', marginBottom: 8 }}>
            Captura por IA indisponível
          </h2>
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.55)', lineHeight: 1.6 }}>
            Seu acesso compartilhado é de visualização. A criação de atividades e documentos
            por IA está disponível apenas com acesso completo. Fale com {access.ownerName ?? 'o proprietário'} para ajustar.
          </p>
        </div>
      </div>
    )
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="min-h-screen flex items-center justify-center musgo-bg">
        <div className="text-center animate-scale-in">
          <div className="w-20 h-20 rounded-[24px] flex items-center justify-center mx-auto mb-5"
            style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', boxShadow: '0 12px 32px rgba(44,74,46,.30)' }}>
            <Check size={36} color="#D4E8D5" strokeWidth={3} />
          </div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 28, fontWeight: 700, color: '#1A2B1C' }}>
            Tudo organizado!
          </h2>
          <p className="text-sm mt-2 italic" style={{ color: 'rgba(26,43,28,0.50)' }}>Atividades, lembretes e documentos salvos ✨</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 space-y-5">

      {/* Header */}
      <div className="animate-fade-up">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] mb-2 flex items-center gap-2" style={{ color: '#5A8C5E' }}>
          <span className="inline-block w-4 h-[2px] rounded" style={{ background: 'linear-gradient(90deg,#5A8C5E,#C49A6C)' }} />
          Inteligência Artificial
        </p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 34, fontWeight: 700, color: '#1A2B1C', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
          Captura com IA
        </h1>
        <p className="text-sm mt-1 italic" style={{ color: 'rgba(26,43,28,0.50)' }}>
          Envie áudio, prints de tela, fotos, documentos ou texto corrido — a IA classifica e organiza tudo automaticamente na agenda e inclui lembretes.
        </p>
      </div>

      {/* Legenda dos tipos */}
      <div className="animate-fade-up grid grid-cols-3 gap-2">
        {[
          { icon: BookOpen,   label: 'Agenda',     desc: 'Provas, consultas, eventos', color: '#2563EB', bg: 'rgba(37,99,235,0.08)' },
          { icon: Bell,       label: 'Pendências',  desc: 'Lembretes sem data',         color: '#D97706', bg: 'rgba(217,119,6,0.08)'  },
          { icon: FolderLock, label: 'Documentos',  desc: 'RG, carteirinhas, contratos', color: '#10B981', bg: 'rgba(16,185,129,0.08)' },
        ].map(({ icon: Icon, label, desc, color, bg }) => (
          <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-2xl text-center" style={{ background: bg }}>
            <Icon size={16} color={color} strokeWidth={2} />
            <span className="text-xs font-bold" style={{ color }}>{label}</span>
            <span className="text-[10px] italic leading-tight" style={{ color: 'rgba(26,43,28,0.45)' }}>{desc}</span>
          </div>
        ))}
      </div>

      {/* Child selector */}
      {children.length > 0 && (
        <div className="animate-fade-up" style={{ ...CARD, padding: '16px 18px' }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.10em', color: 'rgba(26,43,28,0.50)', marginBottom: 10 }}>
            Para qual filho?
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {children.map(c => {
              const sel = selectedChildIds.includes(c.id)
              return (
                <button key={c.id} type="button" onClick={() => toggleDefaultChild(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, cursor: 'pointer',
                    border: `2px solid ${sel ? c.avatar_color : 'rgba(61,102,65,0.18)'}`,
                    background: sel ? `${c.avatar_color}14` : 'rgba(255,255,255,0.70)', transition: 'all .18s' }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: c.avatar_color, fontWeight: 700, fontSize: 13, color: 'white' }}>
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: sel ? c.avatar_color : '#1A2B1C' }}>{c.name}</span>
                  {sel && <Check size={13} strokeWidth={3} style={{ color: c.avatar_color }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Mode tabs */}
      <div className="animate-fade-up p-[6px] flex gap-1.5" style={{ ...CARD, padding: 6 }}>
        {[{ key: 'image', label: 'Foto / Imagem', icon: Camera }, { key: 'text', label: 'Texto livre ou áudio', icon: FileText }].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setMode(key as 'image' | 'text'); setActivities(null); setReminders(null); setDocuments(null); setError('') }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[12px] text-sm font-bold transition-all"
            style={mode === key
              ? { background: '#14463A', color: '#fff', boxShadow: '0 4px 12px rgba(20,70,58,0.28)' }
              : { color: 'rgba(26,43,28,0.50)', background: 'transparent' }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Image upload */}
      {mode === 'image' && (
        <div className="animate-fade-up space-y-3">
          {/* Tirar foto — abre a câmera do celular direto (não a galeria) */}
          <button type="button" onClick={() => cameraRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[13px] text-sm font-bold transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', boxShadow: '0 4px 14px rgba(255,107,92,0.30)' }}>
            <Camera size={16} /> Tirar foto
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => e.target.files && addFiles(e.target.files)} />

          <div className="flex items-center gap-3 py-1">
            <div style={{ flex: 1, height: 1, background: 'rgba(61,102,65,0.15)' }} />
            <span className="text-xs font-semibold" style={{ color: 'rgba(26,43,28,0.35)' }}>ou</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(61,102,65,0.15)' }} />
          </div>

          <div className="cursor-pointer transition-all" style={{ ...CARD, textAlign: 'center', padding: '24px 20px', borderStyle: 'dashed', borderWidth: 2, borderColor: images.length > 0 ? 'rgba(61,102,65,0.40)' : 'rgba(61,102,65,0.22)' }}
            onClick={() => fileRef.current?.click()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            onDragOver={e => e.preventDefault()}>
            <div className="w-12 h-12 rounded-[16px] flex items-center justify-center mx-auto mb-2"
              style={{ backgroundImage: 'linear-gradient(140deg,#D1FAE5,#A7F3D0)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <Upload size={20} color="#3D6641" />
            </div>
            <p className="font-bold text-sm mb-0.5" style={{ color: '#1A2B1C' }}>Clique ou arraste imagens aqui</p>
            <p className="text-xs italic" style={{ color: 'rgba(26,43,28,0.45)' }}>Agenda escolar, documentos, anotações, prints</p>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => e.target.files && addFiles(e.target.files)} />
          </div>

          <div className="flex items-center gap-3 py-1">
            <div style={{ flex: 1, height: 1, background: 'rgba(61,102,65,0.15)' }} />
            <span className="text-xs font-semibold" style={{ color: 'rgba(26,43,28,0.35)' }}>ou</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(61,102,65,0.15)' }} />
          </div>

          {/* Paste zone */}
          <div ref={pasteZoneRef} tabIndex={0} role="button" aria-label="Área de colagem"
            onClick={() => pasteZoneRef.current?.focus()}
            onFocus={() => setPasteZoneFocused(true)}
            onBlur={() => { setPasteZoneFocused(false); setPasteHint(false) }}
            onPaste={e => {
              e.preventDefault()
              const items = Array.from(e.clipboardData?.items ?? []).filter(it => it.type.startsWith('image/'))
              if (!items.length) { setError('Nenhuma imagem no clipboard.'); return }
              addFiles(items.map(it => it.getAsFile()).filter(Boolean) as File[])
              setPasteHint(true)
              setTimeout(() => { setPasteHint(false); pasteZoneRef.current?.blur() }, 1500)
            }}
            style={{ ...CARD, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, cursor: 'pointer', outline: 'none', borderWidth: 2, borderStyle: 'solid', borderColor: pasteHint ? '#3D6641' : pasteZoneFocused ? 'rgba(61,102,65,0.60)' : 'rgba(61,102,65,0.22)', transition: 'border-color .2s' }}>
            {pasteHint ? (
              <><div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)' }}><Check size={20} color="#D4E8D5" strokeWidth={3} /></div><p className="font-bold text-sm" style={{ color: '#3D6641' }}>Imagem colada!</p></>
            ) : pasteZoneFocused ? (
              <><div className="w-10 h-10 rounded-full flex items-center justify-center animate-pulse" style={{ background: 'rgba(61,102,65,0.15)', border: '2px solid rgba(61,102,65,0.35)' }}><Upload size={16} color="#3D6641" /></div><p className="font-bold text-sm" style={{ color: '#3D6641' }}>Pressione Ctrl+V agora</p></>
            ) : (
              <><div className="flex items-center gap-2"><Upload size={16} color="#3D6641" /><span className="font-bold text-sm" style={{ color: '#1A2B1C' }}>Colar captura de tela</span></div><p className="text-xs italic" style={{ color: 'rgba(26,43,28,0.45)' }}>Clique aqui e pressione <kbd style={{ fontFamily: 'monospace', fontSize: 11, padding: '1px 5px', borderRadius: 4, background: 'rgba(61,102,65,0.10)', border: '1px solid rgba(61,102,65,0.25)', color: '#3D6641' }}>Ctrl+V</kbd></p></>
            )}
          </div>

          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5">
              {previews.map((url, i) => (
                <div key={i} className="relative group rounded-[13px] overflow-hidden"
                  style={{ aspectRatio: '1', border: '1px solid rgba(61,102,65,0.22)', boxShadow: '0 2px 8px rgba(44,74,46,0.10)' }}>
                  <img src={url} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(26,43,28,0.55)' }}>
                    <button onClick={e => { e.stopPropagation(); removeImage(i) }} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.90)', color: 'white' }}><X size={16} strokeWidth={2.5} /></button>
                  </div>
                  <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(44,74,46,0.85)', color: '#D4E8D5' }}>{i + 1}</div>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} className="flex flex-col items-center justify-center gap-1 rounded-[13px] transition-all" style={{ aspectRatio: '1', border: '2px dashed rgba(61,102,65,0.22)', background: 'rgba(61,102,65,0.04)', color: 'rgba(26,43,28,0.40)' }}>
                <Plus size={20} /><span className="text-[11px] font-semibold">Adicionar</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Text + voice input */}
      {mode === 'text' && (
        <div className="animate-fade-up space-y-3">
          <div style={{ ...CARD, padding: 16 }}>
            <label className="block text-xs font-bold mb-2 uppercase tracking-[0.08em]" style={{ color: 'rgba(26,43,28,0.50)' }}>
              Digite ou cole o texto
            </label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
              placeholder="Ex: Prova de matemática dia 15/06, consulta pediatra 20/06 às 14h, renovar carteirinha do plano de saúde, RG do João..."
              className="w-full resize-none outline-none text-sm" style={{ background: 'transparent', color: '#1A2B1C' }} />
          </div>

          <div className="animate-fade-up flex flex-col items-center py-4" style={{ ...CARD, padding: '24px 16px' }}>
            <p className="text-xs font-bold uppercase tracking-[0.10em] mb-5" style={{ color: 'rgba(26,43,28,0.40)' }}>
              ou grave um áudio
            </p>
            {voiceBlocked ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(107,114,128,0.10)' }}>
                  <Lock size={20} color="rgba(107,114,128,0.60)" />
                </div>
                <p className="text-xs font-semibold" style={{ color: 'rgba(26,43,28,0.45)' }}>Entrada por voz disponível no plano Família</p>
                <a href="/planos" className="text-xs font-bold underline" style={{ color: '#3D6641' }}>Ver planos</a>
              </div>
            ) : (
              <VoiceInputButton
                onTranscript={t => setText(prev => prev ? `${prev} ${t}` : t)}
                onError={msg => setError(msg)}
              />
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs font-semibold px-4 py-3 rounded-[13px] animate-fade-up flex items-center gap-2"
          style={{ background: 'linear-gradient(140deg,#FEE2E2,#FECACA)', color: '#991B1B', border: '1px solid rgba(220,38,38,0.20)' }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Badge de uso de IA (só plano free) */}
      {aiLimit !== null && (
        <div className="flex items-center justify-between px-1">
          <span style={{ fontSize: 12, color: 'rgba(26,43,28,0.50)', fontWeight: 500 }}>
            Capturas de IA este mês
          </span>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: aiBlocked ? 'rgba(220,38,38,0.10)' : 'rgba(61,102,65,0.10)',
            color: aiBlocked ? '#DC2626' : '#3D6641',
          }}>
            {aiUsed ?? '–'} / {aiLimit}
          </span>
        </div>
      )}

      {/* Upgrade prompt quando IA bloqueada */}
      {aiBlocked && (
        <div className="rounded-2xl p-4 animate-fade-up" style={{
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
                Limite de {aiLimit} capturas atingido
              </p>
              <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.60)', margin: '0 0 12px', lineHeight: 1.5 }}>
                Seu limite mensal de capturas por IA foi atingido. Faça upgrade para capturas ilimitadas.
              </p>
              <a href="/planos"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(140deg,#C49A6C,#A07848)', textDecoration: 'none' }}>
                Ver planos →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Extract button */}
      <button onClick={handleExtract}
        disabled={loading || aiBlocked || (mode === 'image' ? images.length === 0 : !text.trim())}
        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-[16px] text-base font-bold transition-all hover:brightness-105 active:scale-95 disabled:opacity-50"
        style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', boxShadow: '0 6px 20px rgba(255,107,92,0.30)' }}>
        {loading
          ? <><Loader2 size={18} className="animate-spin" /> Analisando{images.length > 1 ? ` ${images.length} imagens` : ''}...</>
          : aiBlocked
            ? <><Lock size={18} /> Limite mensal atingido</>
            : <><Sparkles size={18} /> Analisar e classificar com IA</>}
      </button>

      {/* Results */}
      {hasResults && (
        <div className="space-y-6 animate-fade-up">

          {/* Contador geral */}
          <div className="flex items-center justify-between">
            <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 22, fontWeight: 600, color: '#1A2B1C' }}>
              Resultado da análise
            </h2>
            <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: 'linear-gradient(140deg,#FEF3C7,#FDE68A)', color: '#92400E', border: '1px solid rgba(146,64,14,0.18)' }}>
              {totalSelected} selecionado{totalSelected !== 1 ? 's' : ''}
            </span>
          </div>

          {/* === ATIVIDADES === */}
          {activities !== null && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(37,99,235,0.12)' }}>
                  <BookOpen size={13} color="#2563EB" />
                </div>
                <h3 className="font-bold text-sm" style={{ color: '#1A2B1C' }}>
                  Agenda / Compromissos ({datedRenderItems.length} item{datedRenderItems.length !== 1 ? 's' : ''}
                  {activities.length !== datedRenderItems.length && datedRenderItems.some(it => it.kind === 'group') ? `, ${activities.length - undatedActivities.length} ocorrências` : ''})
                </h3>
              </div>

              {/* Destino na aba Escola — só quando a IA classificou algo como escola */}
              {activities.some(a => a.category === 'escola') && (
                <div className="mb-3 p-3 rounded-[13px]" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.18)' }}>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] mb-2" style={{ color: 'rgba(26,43,28,0.55)' }}>
                    O que você capturou de escola?
                  </label>
                  <div className="flex gap-2">
                    {(['atividade', 'aula'] as SchoolKind[]).map(k => {
                      const active = schoolKind === k
                      return (
                        <button key={k} type="button" onClick={() => setSchoolKind(k)}
                          className="flex-1 py-2 px-3 rounded-[11px] text-xs font-bold transition-all"
                          style={active
                            ? { background: '#2563EB', color: '#fff', border: '1px solid #2563EB' }
                            : { background: 'rgba(255,255,255,0.80)', color: 'rgba(26,43,28,0.55)', border: '1px solid rgba(37,99,235,0.20)' }}>
                          {k === 'atividade' ? '📘' : '🕘'} {SCHOOL_KIND_LABELS[k]}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] italic mt-2" style={{ color: 'rgba(26,43,28,0.45)' }}>
                    {schoolKind === 'atividade'
                      ? 'Provas, trabalhos, reuniões e eventos — vão para “Atividades escolares”.'
                      : 'Grade semanal de aulas — vai para “Rotina de aulas”.'}
                  </p>
                </div>
              )}
              {activities.length === 0 ? (
                <p className="text-xs italic px-2" style={{ color: 'rgba(26,43,28,0.40)' }}>Nenhuma atividade agendada identificada</p>
              ) : datedRenderItems.length === 0 ? (
                <p className="text-xs italic px-2" style={{ color: 'rgba(26,43,28,0.40)' }}>Nenhuma com data — veja em Pendências / Lembretes abaixo</p>
              ) : (
                <div className="space-y-2">
                  {datedRenderItems.map(item => {
                    if (item.kind === 'single') {
                      const i = item.index
                      const a = activities[i]
                      const cat = ACT_CONFIG[a.category] ?? ACT_CONFIG.escola
                      return (
                        <div key={i} style={{ ...CARD, padding: '12px 14px', opacity: a.selected ? 1 : 0.5 }}>
                          <div className="flex items-start gap-3">
                            <button onClick={() => setActivities(prev => prev!.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                              className="mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-none transition-all"
                              style={a.selected ? { background: cat.icolor, borderColor: cat.icolor, color: '#fff' } : { borderColor: 'rgba(61,102,65,0.22)' }}>
                              {a.selected && <Check size={11} strokeWidth={3} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <input
                                type="text"
                                value={a.title}
                                onChange={e => setActivities(prev => prev!.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                                onClick={e => e.stopPropagation()}
                                className="font-bold text-sm w-full bg-transparent outline-none rounded-md px-1.5 py-0.5 -mx-1.5 mb-1"
                                style={{ color: '#1A2B1C', border: '1px solid transparent' }}
                                onFocus={e => { e.target.style.border = '1px solid rgba(61,102,65,0.35)'; e.target.style.background = 'rgba(61,102,65,0.05)' }}
                                onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent' }}
                              />
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundImage: cat.ibg, color: cat.icolor }}>{cat.label}</span>
                              </div>
                              <div className="flex gap-2 flex-wrap items-center">
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                  📅
                                  <input type="date" value={a.date ?? ''}
                                    onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => j === i ? { ...x, date: v } : x)) }}
                                    onClick={e => e.stopPropagation()}
                                    className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5"
                                    style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                                </span>
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                  <Clock size={11} />
                                  <input type="time" value={a.time ?? ''}
                                    onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => j === i ? { ...x, time: v } : x)) }}
                                    onClick={e => e.stopPropagation()}
                                    className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5"
                                    style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                                </span>
                                <span className="flex items-center gap-1 text-xs flex-1 min-w-[100px]" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                  <MapPin size={11} className="flex-none" />
                                  <input type="text" value={a.location ?? ''} placeholder="Local"
                                    onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => j === i ? { ...x, location: v } : x)) }}
                                    onClick={e => e.stopPropagation()}
                                    className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5 w-full min-w-0"
                                    style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                                </span>
                              </div>
                              {!a.date && <div className="text-xs font-semibold mt-1 px-2.5 py-1 rounded-[10px] inline-block" style={{ background: 'linear-gradient(140deg,#FEF3C7,#FDE68A)', color: '#92400E' }}>⚠️ Data não identificada</div>}
                              {children.length > 1 && (
                                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                  <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,43,28,0.45)' }}>Filho(a):</span>
                                  {children.map(c => {
                                    const active = a.child_ids.includes(c.id)
                                    return (
                                      <button key={c.id} type="button"
                                        onClick={() => setActivities(prev => prev!.map((x, j) => j !== i ? x : { ...x, child_ids: active ? x.child_ids.filter(id => id !== c.id) : [...x.child_ids, c.id] }))}
                                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, cursor: 'pointer', fontSize: 11, fontWeight: 700, border: `1.5px solid ${active ? c.avatar_color : 'rgba(61,102,65,0.18)'}`, background: active ? `${c.avatar_color}18` : 'rgba(255,255,255,0.70)', color: active ? c.avatar_color : 'rgba(26,43,28,0.45)', transition: 'all .15s' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.avatar_color, display: 'inline-block' }} />
                                        {c.name}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                            <button onClick={() => setActivities(prev => prev!.map((x, j) => j === i ? { ...x, selected: false } : x))} className="flex-none w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}><X size={13} /></button>
                          </div>
                        </div>
                      )
                    }

                    // Grupo recorrente (grade de horário) — um card para todas as ocorrências.
                    const { groupId, indices } = item
                    const groupActs = indices.map(idx => activities[idx])
                    const a0 = groupActs[0]
                    const cat = ACT_CONFIG[a0.category] ?? ACT_CONFIG.escola
                    const dates = groupActs.map(x => x.date).filter((d): d is string => !!d).sort()
                    const allSelected = groupActs.every(x => x.selected)
                    const someSelected = groupActs.some(x => x.selected)
                    return (
                      <div key={groupId} style={{ ...CARD, padding: '12px 14px', opacity: someSelected ? 1 : 0.5, borderLeft: `4px solid ${cat.icolor}` }}>
                        <div className="flex items-start gap-3">
                          <button onClick={() => setActivities(prev => prev!.map((x, j) => indices.includes(j) ? { ...x, selected: !allSelected } : x))}
                            className="mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-none transition-all"
                            style={allSelected ? { background: cat.icolor, borderColor: cat.icolor, color: '#fff' } : { borderColor: 'rgba(61,102,65,0.22)' }}>
                            {allSelected && <Check size={11} strokeWidth={3} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={a0.title}
                              onChange={e => { const v = e.target.value; setActivities(prev => prev!.map((x, j) => indices.includes(j) ? { ...x, title: v } : x)) }}
                              onClick={e => e.stopPropagation()}
                              className="font-bold text-sm w-full bg-transparent outline-none rounded-md px-1.5 py-0.5 -mx-1.5 mb-1"
                              style={{ color: '#1A2B1C', border: '1px solid transparent' }}
                              onFocus={e => { e.target.style.border = '1px solid rgba(61,102,65,0.35)'; e.target.style.background = 'rgba(61,102,65,0.05)' }}
                              onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent' }}
                            />
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundImage: cat.ibg, color: cat.icolor }}>{cat.label}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>
                                <Repeat size={10} /> Toda {dates[0] ? weekdayLabel(dates[0]) : ''}
                              </span>
                            </div>
                            <div className="flex gap-2 flex-wrap items-center">
                              {dates.length > 0 && (
                                <span className="text-xs italic" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                  📅 {fmtDateBR(dates[0])} a {fmtDateBR(dates[dates.length - 1])} · {indices.length} ocorrências
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                <Clock size={11} />
                                <input type="time" value={a0.time ?? ''}
                                  onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => indices.includes(j) ? { ...x, time: v } : x)) }}
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5"
                                  style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                              </span>
                              <span className="flex items-center gap-1 text-xs flex-1 min-w-[100px]" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                <MapPin size={11} className="flex-none" />
                                <input type="text" value={a0.location ?? ''} placeholder="Local"
                                  onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => indices.includes(j) ? { ...x, location: v } : x)) }}
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5 w-full min-w-0"
                                  style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                              </span>
                            </div>
                            {children.length > 1 && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,43,28,0.45)' }}>Filho(a):</span>
                                {children.map(c => {
                                  const active = a0.child_ids.includes(c.id)
                                  return (
                                    <button key={c.id} type="button"
                                      onClick={() => setActivities(prev => prev!.map((x, j) => !indices.includes(j) ? x : { ...x, child_ids: active ? x.child_ids.filter(id => id !== c.id) : [...x.child_ids, c.id] }))}
                                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, cursor: 'pointer', fontSize: 11, fontWeight: 700, border: `1.5px solid ${active ? c.avatar_color : 'rgba(61,102,65,0.18)'}`, background: active ? `${c.avatar_color}18` : 'rgba(255,255,255,0.70)', color: active ? c.avatar_color : 'rgba(26,43,28,0.45)', transition: 'all .15s' }}>
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.avatar_color, display: 'inline-block' }} />
                                      {c.name}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                          <button onClick={() => setActivities(prev => prev!.map((x, j) => indices.includes(j) ? { ...x, selected: false } : x))} className="flex-none w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}><X size={13} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* === LEMBRETES === */}
          {reminders !== null && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(217,119,6,0.12)' }}>
                  <Bell size={13} color="#D97706" />
                </div>
                <h3 className="font-bold text-sm" style={{ color: '#1A2B1C' }}>
                  Pendências / Lembretes ({reminders.length + undatedActivities.length})
                </h3>
              </div>
              {reminders.length === 0 && undatedActivities.length === 0 ? (
                <p className="text-xs italic px-2" style={{ color: 'rgba(26,43,28,0.40)' }}>Nenhuma pendência identificada</p>
              ) : (
                <div className="space-y-2">
                  {undatedActivities.map(({ a, i }) => {
                    const cat = ACT_CONFIG[a.category] ?? ACT_CONFIG.escola
                    return (
                      <div key={`act-${i}`} style={{ ...CARD, padding: '12px 14px', borderLeft: '4px solid #D97706', opacity: a.selected ? 1 : 0.5 }}>
                        <div className="flex items-start gap-3">
                          <button onClick={() => setActivities(prev => prev!.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                            className="mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-none"
                            style={a.selected ? { background: '#D97706', borderColor: '#D97706', color: '#fff' } : { borderColor: 'rgba(61,102,65,0.22)' }}>
                            {a.selected && <Check size={11} strokeWidth={3} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={a.title}
                              onChange={e => setActivities(prev => prev!.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                              onClick={e => e.stopPropagation()}
                              className="font-bold text-sm w-full bg-transparent outline-none rounded-md px-1.5 py-0.5 -mx-1.5 mb-1"
                              style={{ color: '#1A2B1C', border: '1px solid transparent' }}
                              onFocus={e => { e.target.style.border = '1px solid rgba(61,102,65,0.35)'; e.target.style.background = 'rgba(61,102,65,0.05)' }}
                              onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent' }}
                            />
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundImage: cat.ibg, color: cat.icolor }}>{cat.label}</span>
                              <span className="text-[10px] font-semibold" style={{ color: 'rgba(146,64,14,0.75)' }}>sem data · vai para o mural</span>
                            </div>
                            <div className="flex gap-2 flex-wrap items-center">
                              <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                📅
                                <input type="date" value={a.date ?? ''} placeholder="Adicionar data"
                                  onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => j === i ? { ...x, date: v } : x)) }}
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5"
                                  style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                              </span>
                              <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                <Clock size={11} />
                                <input type="time" value={a.time ?? ''}
                                  onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => j === i ? { ...x, time: v } : x)) }}
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5"
                                  style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                              </span>
                              <span className="flex items-center gap-1 text-xs flex-1 min-w-[100px]" style={{ color: 'rgba(26,43,28,0.50)' }}>
                                <MapPin size={11} className="flex-none" />
                                <input type="text" value={a.location ?? ''} placeholder="Local"
                                  onChange={e => { const v = e.target.value || null; setActivities(prev => prev!.map((x, j) => j === i ? { ...x, location: v } : x)) }}
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs italic bg-transparent outline-none rounded px-1 py-0.5 w-full min-w-0"
                                  style={{ color: '#1A2B1C', border: '1px solid rgba(61,102,65,0.18)' }} />
                              </span>
                            </div>
                          </div>
                          <button onClick={() => setActivities(prev => prev!.map((x, j) => j === i ? { ...x, selected: false } : x))} className="flex-none w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}><X size={13} /></button>
                        </div>
                      </div>
                    )
                  })}
                  {reminders.map((r, i) => (
                    <div key={i} style={{ ...CARD, padding: '12px 14px', borderLeft: '4px solid #D97706', opacity: r.selected ? 1 : 0.5 }}>
                      <div className="flex items-start gap-3">
                        <button onClick={() => setReminders(prev => prev!.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                          className="mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-none"
                          style={r.selected ? { background: '#D97706', borderColor: '#D97706', color: '#fff' } : { borderColor: 'rgba(61,102,65,0.22)' }}>
                          {r.selected && <Check size={11} strokeWidth={3} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={r.title}
                            onChange={e => setReminders(prev => prev!.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                            onClick={e => e.stopPropagation()}
                            className="font-bold text-sm w-full bg-transparent outline-none rounded-md px-1.5 py-0.5 -mx-1.5"
                            style={{ color: '#1A2B1C', border: '1px solid transparent' }}
                            onFocus={e => { e.target.style.border = '1px solid rgba(61,102,65,0.35)'; e.target.style.background = 'rgba(61,102,65,0.05)' }}
                            onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent' }}
                          />
                          {r.description && <p className="text-xs italic mt-0.5" style={{ color: 'rgba(26,43,28,0.50)' }}>{r.description}</p>}
                        </div>
                        <button onClick={() => setReminders(prev => prev!.map((x, j) => j === i ? { ...x, selected: false } : x))} className="flex-none w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* === DOCUMENTOS === */}
          {documents !== null && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.12)' }}>
                  <FolderLock size={13} color="#10B981" />
                </div>
                <h3 className="font-bold text-sm" style={{ color: '#1A2B1C' }}>
                  Documentos ({documents.length})
                </h3>
                {mode === 'image' && images.length === 1 && documents.some(d => d.selected) && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#065F46' }}>
                    📎 imagem será anexada
                  </span>
                )}
              </div>
              {documents.length === 0 ? (
                <p className="text-xs italic px-2" style={{ color: 'rgba(26,43,28,0.40)' }}>Nenhum documento identificado</p>
              ) : (
                <div className="space-y-2">
                  {documents.map((d, i) => {
                    const dc = DOC_CONFIG[d.category] ?? DOC_CONFIG.saude
                    return (
                      <div key={i} style={{ ...CARD, padding: '12px 14px', borderLeft: `4px solid ${dc.accent}`, opacity: d.selected ? 1 : 0.5 }}>
                        <div className="flex items-start gap-3">
                          <button onClick={() => setDocuments(prev => prev!.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                            className="mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-none"
                            style={d.selected ? { background: dc.accent, borderColor: dc.accent, color: '#fff' } : { borderColor: 'rgba(61,102,65,0.22)' }}>
                            {d.selected && <Check size={11} strokeWidth={3} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={d.title}
                              onChange={e => setDocuments(prev => prev!.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                              onClick={e => e.stopPropagation()}
                              className="font-bold text-sm w-full bg-transparent outline-none rounded-md px-1.5 py-0.5 -mx-1.5 mb-1"
                              style={{ color: '#1A2B1C', border: '1px solid transparent' }}
                              onFocus={e => { e.target.style.border = '1px solid rgba(61,102,65,0.35)'; e.target.style.background = 'rgba(61,102,65,0.05)' }}
                              onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent' }}
                            />
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: dc.bg, color: dc.accent }}>{dc.label}</span>
                            </div>
                            {d.description && <p className="text-xs italic" style={{ color: 'rgba(26,43,28,0.50)' }}>{d.description}</p>}
                            {d.expires_at && <p className="text-xs mt-0.5" style={{ color: 'rgba(26,43,28,0.45)' }}>Vence {new Date(d.expires_at).toLocaleDateString('pt-BR')}</p>}
                            {children.length > 1 && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,43,28,0.45)' }}>Filho(a):</span>
                                {children.map(c => {
                                  const active = d.child_ids.includes(c.id)
                                  return (
                                    <button key={c.id} type="button"
                                      onClick={() => setDocuments(prev => prev!.map((x, j) => j !== i ? x : { ...x, child_ids: active ? x.child_ids.filter(id => id !== c.id) : [...x.child_ids, c.id] }))}
                                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, cursor: 'pointer', fontSize: 11, fontWeight: 700, border: `1.5px solid ${active ? c.avatar_color : 'rgba(61,102,65,0.18)'}`, background: active ? `${c.avatar_color}18` : 'rgba(255,255,255,0.70)', color: active ? c.avatar_color : 'rgba(26,43,28,0.45)', transition: 'all .15s' }}>
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.avatar_color, display: 'inline-block' }} />
                                      {c.name}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                          <button onClick={() => setDocuments(prev => prev!.map((x, j) => j === i ? { ...x, selected: false } : x))} className="flex-none w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}><X size={13} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* Save button */}
          {totalSelected > 0 && (
            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-[16px] text-sm font-bold transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
              style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', boxShadow: '0 6px 20px rgba(255,107,92,0.30)' }}>
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Salvando...</>
                : <><Check size={16} /> Salvar {totalSelected} item{totalSelected !== 1 ? 's' : ''} selecionado{totalSelected !== 1 ? 's' : ''}</>}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
