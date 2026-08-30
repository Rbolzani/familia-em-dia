'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { avatarPath } from '@/lib/avatars'
import { Plus, Trash2, Camera, ArrowRight, Check, Users, Sparkles, Mic, ImageIcon, Type, X, Loader2, CalendarDays, Bot, Share2, Baby, Handshake } from 'lucide-react'

const supabase = createClient()

const AVATAR_COLORS = [
  '#F4522D','#F5A623','#00C48C','#2563EB',
  '#7C3AED','#DB2777','#0891B2','#059669',
]

interface AiActivity {
  title: string
  date?: string | null
  time?: string | null
  category?: string
  description?: string | null
}

interface AiExtractResult {
  activities?: AiActivity[]
  reminders?: { title: string }[]
  documents?: { title: string; category?: string }[]
}

interface ChildForm {
  id: string
  name: string
  birth_date: string
  school_name: string
  avatar_color: string
  photoFile: File | null
  photoPreview: string | null
}

function newChildForm(): ChildForm {
  return {
    id: crypto.randomUUID(),
    name: '',
    birth_date: '',
    school_name: '',
    avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    photoFile: null,
    photoPreview: null,
  }
}

// ── Step indicator ─────────────────────────────────────────────────────────
function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div style={{
      width: 10, height: 10, borderRadius: '50%',
      background: done ? '#3D6641' : active ? '#5A8C5E' : 'rgba(61,102,65,0.18)',
      transition: 'all 0.3s',
      flexShrink: 0,
    }} />
  )
}

// ── Mini avatar preview ────────────────────────────────────────────────────
function MiniAvatar({ child }: { child: ChildForm }) {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
      background: child.photoPreview ? 'transparent' : child.avatar_color,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-lora)', fontWeight: 700, fontSize: 18, color: 'white',
      boxShadow: `0 4px 12px ${child.avatar_color}55`,
    }}>
      {child.photoPreview
        ? <img src={child.photoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : child.name.charAt(0).toUpperCase() || '?'
      }
    </div>
  )
}

// ── Child form card ────────────────────────────────────────────────────────
function ChildCard({
  child, index, onChange, onRemove, canRemove,
}: {
  child: ChildForm
  index: number
  onChange: (id: string, patch: Partial<ChildForm>) => void
  onRemove: (id: string) => void
  canRemove: boolean
}) {
  const inputId = `photo-${child.id}`
  const blobRef = useRef<string | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
    const url = URL.createObjectURL(f)
    blobRef.current = url
    onChange(child.id, { photoFile: f, photoPreview: url })
    e.target.value = ''
  }

  return (
    <div style={{
      background: 'white',
      borderRadius: '17px 11px 15px 13px',
      border: '1px solid rgba(61,102,65,0.12)',
      padding: '20px',
      boxShadow: '0 2px 12px rgba(44,74,46,0.06)',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(26,43,28,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Filho {index + 1}
        </span>
        {canRemove && (
          <button type="button" onClick={() => onRemove(child.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(220,38,38,0.6)', padding: 4 }}>
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {/* Photo + color */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <label htmlFor={inputId} style={{
          width: 72, height: 72, borderRadius: 18, flexShrink: 0,
          background: child.photoPreview ? 'transparent' : child.avatar_color,
          overflow: 'hidden', cursor: 'pointer', position: 'relative',
          border: '2px dashed rgba(61,102,65,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 14px ${child.avatar_color}44`,
        }}>
          {child.photoPreview
            ? <img src={child.photoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <>{child.name
                ? <span style={{ fontFamily: 'var(--font-lora)', fontWeight: 700, fontSize: 28, color: 'white' }}>{child.name.charAt(0).toUpperCase()}</span>
                : <Camera size={24} color="rgba(61,102,65,0.4)" />
              }</>
          }
          <div style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(0,0,0,0.4)', borderRadius: 6, padding: 3 }}>
            <Camera size={10} color="white" />
          </div>
        </label>
        <input id={inputId} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

        {/* Color picker */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1 }}>
          {AVATAR_COLORS.map(c => (
            <button key={c} type="button" onClick={() => onChange(child.id, { avatar_color: c })}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                outline: child.avatar_color === c ? `3px solid ${c}` : 'none',
                outlineOffset: 2, transition: 'all 0.15s',
              }} />
          ))}
        </div>
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(26,43,28,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Nome *
          </label>
          <input
            type="text" required placeholder="Ex: Maria"
            value={child.name}
            onChange={e => onChange(child.id, { name: e.target.value })}
            className="input-field"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(26,43,28,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Nascimento
            </label>
            <input
              type="date"
              value={child.birth_date}
              onChange={e => onChange(child.id, { birth_date: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(26,43,28,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Escola
            </label>
            <input
              type="text" placeholder="Nome da escola"
              value={child.school_name}
              onChange={e => onChange(child.id, { school_name: e.target.value })}
              className="input-field"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main onboarding component ──────────────────────────────────────────────
export default function OnboardingClient({ firstName }: { firstName: string }) {
  const router = useRouter()
  const [step, setStep] = useState<'welcome' | 'children' | 'invite' | 'ai' | 'done'>('welcome')
  const [children, setChildren] = useState<ChildForm[]>([newChildForm()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function updateChild(id: string, patch: Partial<ChildForm>) {
    setChildren(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function addChild() {
    setChildren(prev => [...prev, newChildForm()])
  }

  function removeChild(id: string) {
    setChildren(prev => prev.filter(c => c.id !== id))
  }

  /** Devolve o CAMINHO (`<family_id>/<child_id>.<ext>`), não uma URL. */
  async function uploadPhoto(famId: string, childId: string, file: File): Promise<string | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = avatarPath(famId, childId, ext)
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (error) return null
    return path
  }

  async function saveChildren() {
    const valid = children.filter(c => c.name.trim())
    if (valid.length === 0) { setError('Adicione pelo menos um filho para continuar.'); return }

    setSaving(true)
    setError(null)

    try {
      // Inserir filhos via API route (usa service role, bypassa RLS)
      const res = await fetch('/api/onboarding/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          children: valid.map(c => ({
            name: c.name.trim(),
            birth_date: c.birth_date || null,
            school_name: c.school_name.trim() || null,
            avatar_color: c.avatar_color,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'LIMIT_CHILDREN') {
          throw new Error(`Seu plano permite até ${json.limit} ${json.limit === 1 ? 'filho' : 'filhos'}. Faça upgrade para adicionar mais.`)
        }
        throw new Error(json.error ?? 'Erro ao salvar filhos.')
      }

      // Upload de fotos para os filhos inseridos. A pasta é a FAMÍLIA, então
      // o family_id precisa existir — a rota de onboarding acabou de criá-lo.
      const { data: famId } = await supabase.rpc('auth_family_id')
      if (famId) {
        for (let i = 0; i < valid.length; i++) {
          const child = valid[i]
          const inserted = json.children?.[i]
          if (child.photoFile && inserted?.id) {
            const path = await uploadPhoto(famId as string, inserted.id, child.photoFile)
            if (path) await supabase.from('children').update({ avatar_path: path }).eq('id', inserted.id)
          }
        }
      }

      // Gerar link de convite (acesso completo, sem email)
      const origin = window.location.origin
      const { data: invite } = await supabase.rpc('create_invite', {
        p_email: null,
        p_access_role: 'full_editor',
      })
      if (invite) setInviteLink(`${origin}/convite/${invite}`)

      setStep('invite')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.')
    } finally {
      setSaving(false)
    }
  }

  function copyLink() {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function sendWhatsApp() {
    if (!inviteLink) return
    const msg = encodeURIComponent(`Olá! Estou usando o Família em Dia para organizar a rotina dos nossos filhos. Clique no link para ter acesso: ${inviteLink}`)
    window.open(`https://wa.me/?text=${msg}`, '_blank')
  }

  // ── AI demo state ─────────────────────────────────────────────────────────
  const [aiMode, setAiMode] = useState<'text' | 'image'>('text')
  const [aiInput, setAiInput] = useState('')
  const [aiImage, setAiImage] = useState<{ file: File; preview: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<AiExtractResult | null>(null)
  const [aiSaved, setAiSaved] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const aiImageInputRef = useRef<HTMLInputElement>(null)

  async function runAiDemo() {
    if (!aiInput.trim() && !aiImage) return
    setAiLoading(true)
    setAiResult(null)
    setAiError(null)
    try {
      let body: FormData | string
      let headers: Record<string, string> = {}
      if (aiImage) {
        const fd = new FormData()
        fd.append('image', aiImage.file)
        if (aiInput.trim()) fd.append('text', aiInput.trim())
        body = fd
      } else {
        body = JSON.stringify({ text: aiInput.trim() })
        headers['Content-Type'] = 'application/json'
      }
      const res = await fetch('/api/ai-extract', { method: 'POST', headers, body: body as BodyInit })
      if (!res.ok) throw new Error('Erro na análise. Tente novamente.')
      const json = await res.json()
      setAiResult(json)
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'Erro desconhecido.')
    } finally {
      setAiLoading(false)
    }
  }

  async function saveAiItems() {
    if (!aiResult || aiSaved) return
    setAiSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error()
      const { data: childList } = await supabase.from('children').select('id').limit(1)
      const childId = childList?.[0]?.id ?? null

      for (const item of (aiResult.activities ?? [])) {
        await supabase.from('activities').insert({
          user_id: user.id,
          child_id: childId,
          title: item.title,
          date: item.date ?? null,
          time: item.time ?? null,
          category: item.category ?? 'escola',
          description: item.description ?? null,
          ai_generated: true,
          status: 'pendente',
        })
      }
      setAiSaved(true)
    } catch {
      // silent — user can try again
    } finally {
      setAiSaving(false)
    }
  }

  async function startVoice() {
    if (recording) {
      mediaRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const fd = new FormData()
        fd.append('audio', blob, 'rec.webm')
        try {
          const res = await fetch('/api/voice-transcribe', { method: 'POST', body: fd })
          const json = await res.json()
          if (json.text) setAiInput(prev => prev ? `${prev} ${json.text}` : json.text)
        } catch { /* ignore */ }
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true)
    } catch { /* microphone denied */ }
  }

  function handleAiImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    setAiImage({ file: f, preview: url })
    setAiMode('image')
    e.target.value = ''
  }

  function finish() {
    router.push('/dashboard')
  }

  // ── Styles base ────────────────────────────────────────────────────────
  const container: React.CSSProperties = {
    minHeight: '100dvh',
    background: 'linear-gradient(160deg, #F8F3EA 0%, #EEF5EF 100%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: 'var(--font-dm-sans)',
  }

  const card: React.CSSProperties = {
    background: 'white',
    borderRadius: '24px 18px 22px 20px',
    boxShadow: '0 8px 40px rgba(44,74,46,0.10)',
    width: '100%', maxWidth: 480,
    padding: '32px 28px',
    display: 'flex', flexDirection: 'column', gap: 24,
  }

  const btn: React.CSSProperties = {
    width: '100%', padding: '14px', borderRadius: 13, border: 'none',
    background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)',
    color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    boxShadow: '0 6px 20px rgba(255,107,92,0.30)',
    transition: 'opacity 0.15s',
    opacity: saving ? 0.7 : 1,
  }

  // ── Step: Welcome ──────────────────────────────────────────────────────
  if (step === 'welcome') return (
    <div style={container}>
      {/* Logo */}
      <div style={{ marginBottom: 24, textAlign: 'center' }}>
        <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 46, width: 'auto', display: 'block', margin: '0 auto' }} />
      </div>

      <div style={card}>
        {/* Step dots — 4 steps total */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <StepDot active={true} done={false} />
          <StepDot active={false} done={false} />
          <StepDot active={false} done={false} />
          <StepDot active={false} done={false} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(61,102,65,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Handshake size={28} color="#3D6641" />
          </div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 22, fontWeight: 700, color: '#1A2B1C', margin: '0 0 10px' }}>
            Olá, {firstName}!
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(26,43,28,0.60)', lineHeight: 1.6, margin: 0 }}>
            Bem-vindo ao seu espaço familiar. Em poucos passos, vamos organizar a rotina dos seus filhos — escola, saúde, atividades e muito mais.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { icon: <CalendarDays size={18} color="#3D6641" />, text: 'Agenda escolar e atividades centralizadas' },
            { icon: <Bot size={18} color="#3D6641" />, text: 'IA que organiza por foto, texto ou voz' },
            { icon: <Share2 size={18} color="#3D6641" />, text: 'Compartilhe com o seu parceiro(a)' },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(61,102,65,0.05)', borderRadius: 12 }}>
              <div style={{ flexShrink: 0 }}>{icon}</div>
              <span style={{ fontSize: 14, color: '#2C4A2E', fontWeight: 500 }}>{text}</span>
            </div>
          ))}
        </div>

        <button style={btn} onClick={() => setStep('children')}>
          Vamos começar <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )

  // ── Step: Children ─────────────────────────────────────────────────────
  if (step === 'children') return (
    <div style={container}>
      <div style={{ marginBottom: 20, textAlign: 'center' }}>
        <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 38, width: 'auto', display: 'block', margin: '0 auto' }} />
      </div>

      <div style={{ ...card, maxHeight: 'calc(100dvh - 140px)', overflowY: 'auto' }}>
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <StepDot active={false} done={true} />
          <StepDot active={true} done={false} />
          <StepDot active={false} done={false} />
          <StepDot active={false} done={false} />
        </div>

        <div>
          <div style={{ width: 48, height: 48, borderRadius: 15, background: 'rgba(61,102,65,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Baby size={24} color="#3D6641" />
          </div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 20, fontWeight: 700, color: '#1A2B1C', margin: '0 0 6px' }}>
            Quem são seus filhos?
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(26,43,28,0.55)', margin: 0 }}>
            Adicione um ou mais filhos para começar. Você pode editar depois.
          </p>
        </div>

        {/* Child cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children.map((child, i) => (
            <ChildCard
              key={child.id}
              child={child}
              index={i}
              onChange={updateChild}
              onRemove={removeChild}
              canRemove={children.length > 1}
            />
          ))}
        </div>

        {/* Add child button */}
        <button
          type="button"
          onClick={addChild}
          style={{
            width: '100%', padding: '12px', borderRadius: 13,
            border: '1.5px dashed rgba(61,102,65,0.35)',
            background: 'rgba(61,102,65,0.04)', color: '#3D6641',
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
          <Plus size={16} /> Adicionar outro filho
        </button>

        {error && (
          <p style={{ color: '#DC2626', fontSize: 13, textAlign: 'center', margin: 0 }}>{error}</p>
        )}

        <button style={btn} onClick={saveChildren} disabled={saving}>
          {saving ? 'Salvando...' : <><Check size={16} /> Confirmar filhos <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  )

  // ── Step: Invite ───────────────────────────────────────────────────────
  if (step === 'invite') return (
    <div style={container}>
      <div style={{ marginBottom: 20, textAlign: 'center' }}>
        <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 38, width: 'auto', display: 'block', margin: '0 auto' }} />
      </div>

      <div style={card}>
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <StepDot active={false} done={true} />
          <StepDot active={false} done={true} />
          <StepDot active={true} done={false} />
          <StepDot active={false} done={false} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(61,102,65,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Users size={28} color="#3D6641" />
          </div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 20, fontWeight: 700, color: '#1A2B1C', margin: '0 0 8px' }}>
            Convide seu parceiro(a)
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(26,43,28,0.55)', lineHeight: 1.6, margin: 0 }}>
            Compartilhe a rotina dos filhos em tempo real. Você pode convidar depois também.
          </p>
        </div>

        {inviteLink && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Link box */}
            <div style={{
              background: 'rgba(61,102,65,0.06)', borderRadius: 12,
              padding: '12px 14px', border: '1px solid rgba(61,102,65,0.15)',
              fontSize: 12, color: '#2C4A2E', wordBreak: 'break-all', lineHeight: 1.5,
            }}>
              {inviteLink}
            </div>

            <button onClick={copyLink} style={{
              ...btn,
              background: copied ? 'linear-gradient(140deg,#059669,#047857)' : 'linear-gradient(140deg,#FF8A6E,#FF6B5C)',
            }}>
              {copied ? <><Check size={16} /> Copiado!</> : 'Copiar link de convite'}
            </button>

            <button onClick={sendWhatsApp} style={{
              ...btn,
              background: 'linear-gradient(140deg,#25D366,#128C7E)',
            }}>
              <span style={{ fontSize: 16 }}>💬</span> Enviar pelo WhatsApp
            </button>

            <button onClick={() => setStep('ai')} style={btn}>
              Continuar <ArrowRight size={16} />
            </button>
          </div>
        )}

        <button
          onClick={() => setStep('ai')}
          style={{
            width: '100%', padding: '13px', borderRadius: 13,
            border: '1.5px solid rgba(61,102,65,0.25)',
            background: 'transparent', color: '#3D6641',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
          <Users size={15} /> Convidar depois
        </button>
      </div>
    </div>
  )

  // ── Step: AI demo ─────────────────────────────────────────────────────
  if (step === 'ai') return (
    <div style={container}>
      <div style={{ marginBottom: 20, textAlign: 'center' }}>
        <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 38, width: 'auto', display: 'block', margin: '0 auto' }} />
      </div>

      <div style={{ ...card, maxHeight: 'calc(100dvh - 140px)', overflowY: 'auto' }}>
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <StepDot active={false} done={true} />
          <StepDot active={false} done={true} />
          <StepDot active={false} done={true} />
          <StepDot active={true} done={false} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(61,102,65,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Bot size={28} color="#3D6641" />
          </div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 20, fontWeight: 700, color: '#1A2B1C', margin: '0 0 8px' }}>
            Experimente a IA agora
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(26,43,28,0.55)', lineHeight: 1.6, margin: 0 }}>
            Fale, escreva ou tire uma foto — a IA extrai e organiza tudo automaticamente.
          </p>
        </div>

        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { mode: 'text' as const, icon: <Type size={15} />, label: 'Texto' },
            { mode: 'image' as const, icon: <ImageIcon size={15} />, label: 'Foto' },
          ] as const).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => { setAiMode(mode); if (mode === 'image') aiImageInputRef.current?.click() }}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 11,
                border: `1.5px solid ${aiMode === mode ? '#3D6641' : 'rgba(61,102,65,0.2)'}`,
                background: aiMode === mode ? 'rgba(61,102,65,0.08)' : 'transparent',
                color: aiMode === mode ? '#2C4A2E' : 'rgba(26,43,28,0.45)',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
              }}>
              {icon} {label}
            </button>
          ))}
          <input ref={aiImageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAiImage} />

          {/* Voice button */}
          <button onClick={startVoice}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 11,
              border: `1.5px solid ${recording ? '#DC2626' : 'rgba(61,102,65,0.2)'}`,
              background: recording ? 'rgba(220,38,38,0.08)' : 'transparent',
              color: recording ? '#DC2626' : 'rgba(26,43,28,0.45)',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.15s',
            }}>
            <Mic size={15} /> {recording ? 'Parar' : 'Voz'}
          </button>
        </div>

        {/* Image preview */}
        {aiImage && (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', maxHeight: 160 }}>
            <img src={aiImage.preview} alt="" style={{ width: '100%', height: 160, objectFit: 'cover' }} />
            <button onClick={() => { setAiImage(null); setAiMode('text') }}
              style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 8,
                width: 28, height: 28, cursor: 'pointer', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Text input */}
        <div style={{ position: 'relative' }}>
          <textarea
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            placeholder={
              aiMode === 'image'
                ? 'Opcional: acrescente uma observação sobre a imagem...'
                : 'Ex: "Maria tem consulta na terça às 14h na Dra. Ana, e prova de português na sexta"'
            }
            rows={3}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: '1.5px solid rgba(61,102,65,0.2)', background: 'rgba(61,102,65,0.03)',
              fontSize: 14, color: '#1A2B1C', resize: 'none', outline: 'none',
              fontFamily: 'var(--font-dm-sans)', lineHeight: 1.6,
              boxSizing: 'border-box',
            }}
          />
          {recording && (
            <div style={{
              position: 'absolute', bottom: 10, right: 12,
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: '#DC2626', fontWeight: 600,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2626', animation: 'pulse 1s infinite' }} />
              Gravando...
            </div>
          )}
        </div>

        {/* Hint pills */}
        {!aiResult && !aiLoading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              'Consulta pediátrica na sexta às 15h',
              'Prova de matemática dia 20',
              'Futebol toda terça às 17h30',
            ].map(hint => (
              <button key={hint} onClick={() => setAiInput(hint)}
                style={{
                  padding: '6px 12px', borderRadius: 20,
                  border: '1px solid rgba(61,102,65,0.2)',
                  background: 'rgba(61,102,65,0.04)',
                  fontSize: 12, color: '#3D6641', cursor: 'pointer',
                  fontFamily: 'var(--font-dm-sans)',
                }}>
                {hint}
              </button>
            ))}
          </div>
        )}

        {aiError && (
          <p style={{ color: '#DC2626', fontSize: 13, textAlign: 'center', margin: 0 }}>{aiError}</p>
        )}

        {/* Result */}
        {aiResult && !aiLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,43,28,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
              IA encontrou:
            </p>
            {(aiResult.activities ?? []).map((a, i) => (
              <div key={i} style={{
                background: 'rgba(61,102,65,0.06)', borderRadius: 11,
                padding: '10px 14px', border: '1px solid rgba(61,102,65,0.12)',
              }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1A2B1C', margin: '0 0 4px' }}>📅 {a.title}</p>
                {a.date && <p style={{ fontSize: 12, color: 'rgba(26,43,28,0.5)', margin: 0 }}>{a.date}{a.time ? ` às ${a.time}` : ''}</p>}
              </div>
            ))}
            {(aiResult.reminders ?? []).map((r, i) => (
              <div key={i} style={{
                background: 'rgba(245,166,35,0.07)', borderRadius: 11,
                padding: '10px 14px', border: '1px solid rgba(245,166,35,0.2)',
              }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1A2B1C', margin: 0 }}>📌 {r.title}</p>
              </div>
            ))}
            {(aiResult.documents ?? []).map((d, i) => (
              <div key={i} style={{
                background: 'rgba(37,99,235,0.06)', borderRadius: 11,
                padding: '10px 14px', border: '1px solid rgba(37,99,235,0.12)',
              }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1A2B1C', margin: 0 }}>📄 {d.title}</p>
              </div>
            ))}
            {!aiSaved ? (
              <button onClick={saveAiItems} disabled={aiSaving} style={{
                ...btn,
                background: 'linear-gradient(140deg,#059669,#047857)',
              }}>
                {aiSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {aiSaving ? 'Salvando...' : 'Salvar na agenda'}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, color: '#059669', fontWeight: 600 }}>
                <Check size={16} /> Salvo com sucesso!
              </div>
            )}
          </div>
        )}

        {/* Analyze button */}
        {!aiResult && (
          <button
            onClick={runAiDemo}
            disabled={aiLoading || (!aiInput.trim() && !aiImage)}
            style={{
              ...btn,
              opacity: aiLoading || (!aiInput.trim() && !aiImage) ? 0.5 : 1,
            }}>
            {aiLoading
              ? <><Loader2 size={16} className="animate-spin" /> Analisando...</>
              : <><Sparkles size={16} /> Analisar com IA</>
            }
          </button>
        )}

        {/* Skip */}
        <button
          onClick={finish}
          style={{
            width: '100%', padding: '12px', borderRadius: 13,
            border: '1.5px solid rgba(61,102,65,0.2)',
            background: 'transparent', color: 'rgba(26,43,28,0.45)',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
          Ir para o dashboard <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )

  // ── Step: Done ─────────────────────────────────────────────────────────
  return (
    <div style={container}>
      <div style={card}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 22, fontWeight: 700, color: '#1A2B1C', margin: '0 0 10px' }}>
            Tudo pronto!
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(26,43,28,0.60)', margin: 0 }}>
            Seu espaço familiar está configurado. Comece adicionando atividades ou usando a IA para organizar a agenda.
          </p>
        </div>
        <button style={btn} onClick={finish}>
          <Sparkles size={16} /> Ir para o dashboard
        </button>
      </div>
    </div>
  )
}
