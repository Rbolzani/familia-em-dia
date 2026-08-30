'use client'
import React, { useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, FileText, ChevronRight, X, Upload, Loader2, Sparkles } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { Child, AppDocument, DocumentCategory } from '@/lib/types'
import { useAccess } from '@/components/access/AccessContext'
import { getVaultCategory } from '@/lib/vault'
import { ocrDocument, isOcrable } from '@/lib/ocr'
import { ACCEPT_ATTR } from '@/lib/uploadTypes'
import { getDocType, seedDocValues, splitDocValues, DOC_TYPE_KEYS } from '@/lib/docTypes'
import type { DocType } from '@/lib/docTypes'
import DocFormFields from '@/components/vault/DocFormFields'
import { applyDoseReminders } from '@/lib/doseReminders'

function expiryStatus(expires_at: string | null): 'vencido' | 'a vencer' | 'valido' | null {
  if (!expires_at) return null
  const d = new Date(expires_at)
  const now = new Date()
  if (d < now) return 'vencido'
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diff <= 30) return 'a vencer'
  return 'valido'
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  vencido:   { bg: 'rgba(239,68,68,0.12)',  color: '#B91C1C', label: 'Vencido' },
  'a vencer':{ bg: 'rgba(245,158,11,0.12)', color: '#92400E', label: 'A vencer' },
  valido:    { bg: 'rgba(16,185,129,0.12)', color: '#065F46', label: 'Válido' },
}

interface Props {
  category: DocumentCategory
  children: Child[]
  documents: AppDocument[]
  canOcr: boolean
}

export default function GavetaClient({ category, children, documents: initialDocs, canOcr }: Props) {
  const router = useRouter()
  const { canEdit } = useAccess()
  const cat = getVaultCategory(category)
  const meta = { label: cat?.label ?? category, accent: cat?.accent ?? '#3D6641', desc: cat?.desc ?? '' }
  const [docs, setDocs] = useState<AppDocument[]>(initialDocs)
  const [childFilter, setChildFilter] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [formStep, setFormStep]   = useState<'upload'|'form'>('upload')

  // Upload form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [childId, setChildId] = useState('')
  const [tags, setTags] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  // OCR / cofre inteligente: natureza + valores por campo (modelo unificado v1c)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [docType, setDocType] = useState<DocType>('outro')
  const [values, setValues]   = useState<Record<string, unknown>>(() => seedDocValues('outro', {}))
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrApplied, setOcrApplied] = useState(false)

  const filtered = childFilter ? docs.filter(d => d.child_id === childFilter) : docs

  // Troca manual de natureza: re-seeda preservando os valores comuns.
  function changeDocType(nt: DocType) {
    setValues(prev => seedDocValues(nt, {
      doc_number: prev.doc_number as string ?? null,
      issuer: prev.issuer as string ?? null,
      issue_date: prev.issue_date as string ?? null,
      expires_at: prev.expires_at as string ?? null,
      metadata: prev,
    }))
    setDocType(nt)
  }

  // Ao selecionar arquivos (frente+verso): roda OCR, classifica a natureza e
  // semeia os campos do tipo. Conveniência — falha é silenciosa.
  async function handleFilesSelected(selected: File[]) {
    setFiles(selected)
    if (!canOcr) { setFormStep('form'); return }
    setOcrLoading(true); setOcrApplied(false)
    const r = await ocrDocument(selected)
    setOcrLoading(false)
    if (!r) {
      // Ver comentário equivalente em VaultClient: falha muda escondia o erro.
      if (selected.some(isOcrable)) {
        toast('Não consegui ler este arquivo. Preencha os campos manualmente.', 'error')
      }
      setFormStep('form'); return
    }
    const nt = r.doc_type ?? 'outro'
    setOcrText(r.ocr_text || null)
    setDocType(nt)
    setValues(seedDocValues(nt, {
      doc_number: r.doc_number, issuer: r.issuer, issue_date: r.issue_date,
      expires_at: r.expires_at, metadata: r.metadata,
    }))
    setTitle(prev => prev.trim() ? prev : (r.title ?? ''))
    setDescription(prev => prev.trim() ? prev : (r.description ?? ''))
    setOcrApplied(true)
    setFormStep('form')
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast('Informe o título do documento', 'error'); return }
    setUploading(true)
    try {
      const { columns, metadata } = splitDocValues(docType, values)
      // Antes de montar o FormData: cria os lembretes de dose faltante e tira
      // `doses_pendentes` do metadata, para não duplicar num salvamento futuro.
      const lembretes = await applyDoseReminders({
        docType, values, metadata, docTitle: title.trim(), childId: childId || null,
      })
      const form = new FormData()
      form.append('title', title.trim())
      form.append('category', category)
      if (childId) form.append('child_id', childId)
      if (description) form.append('description', description.trim())
      if (columns.doc_number) form.append('doc_number', columns.doc_number)
      if (columns.issuer) form.append('issuer', columns.issuer)
      if (columns.issue_date) form.append('issue_date', columns.issue_date)
      if (columns.expires_at) form.append('expires_at', columns.expires_at)
      if (tags.trim()) form.append('tags', tags.trim())
      if (ocrText) form.append('ocr_text', ocrText)
      form.append('doc_type', docType)
      if (Object.keys(metadata).length) form.append('metadata', JSON.stringify(metadata))
      files.forEach(f => form.append('files', f))

      const res = await fetch('/api/documents/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { toast(json.error ?? 'Falha no upload', 'error'); return }

      toast(lembretes > 0
        ? `Documento salvo ✓ · ${lembretes === 1 ? '1 lembrete criado' : `${lembretes} lembretes criados`} no mural`
        : 'Documento salvo com sucesso ✓')
      const childRef = children.find(c => c.id === childId)
      setDocs(prev => [{ ...json.document, child: childRef ? { id: childRef.id, name: childRef.name, avatar_color: childRef.avatar_color } : null, files: json.files }, ...prev])
      setShowUpload(false)
      setTitle(''); setDescription(''); setChildId(''); setTags(''); setFiles([])
      setOcrText(null); setOcrApplied(false); setDocType('outro'); setValues(seedDocValues('outro', {}))
    } catch {
      toast('Erro ao salvar documento', 'error')
    } finally {
      setUploading(false)
    }
  }

  const CARD: React.CSSProperties = {
    background: 'linear-gradient(160deg,#FFFFFF 0%,#F5F0E8 100%)',
    border: '1px solid rgba(61,102,65,0.18)',
    boxShadow: '0 4px 16px rgba(44,74,46,0.08),0 1px 4px rgba(44,74,46,0.05)',
    borderRadius: 16,
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5 overflow-x-hidden">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 animate-fade-up">
        <Link href="/vault" className="flex items-center gap-1 text-sm font-medium transition-colors hover:opacity-70"
          style={{ color: '#3D6641', textDecoration: 'none' }}>
          <ChevronLeft size={16} />
          Documentos
        </Link>
        <span style={{ color: 'rgba(26,43,28,0.30)', fontSize: 14 }}>/</span>
        <span className="text-sm font-bold" style={{ color: '#1A2B1C' }}>{meta.label}</span>
      </div>

      {/* Header */}
      <div className="animate-fade-up">
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 28, fontWeight: 700, color: '#1A2B1C', letterSpacing: '-0.02em' }}>
          {meta.label}
        </h1>
        <p className="text-sm mt-0.5 italic" style={{ color: 'rgba(26,43,28,0.50)' }}>{meta.desc}</p>
      </div>

      {/* Filtro filho */}
      {children.length > 0 && (
        <div className="flex flex-wrap gap-2 animate-fade-up">
          <button
            onClick={() => setChildFilter(null)}
            className="px-3 py-1 rounded-full text-xs font-bold transition-all"
            style={{
              background: !childFilter ? '#14463A' : 'rgba(61,102,65,0.10)',
              color: !childFilter ? '#fff' : '#3D6641',
            }}>
            Todos
          </button>
          {children.map(c => (
            <button key={c.id}
              onClick={() => setChildFilter(c.id === childFilter ? null : c.id)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all"
              style={{
                background: childFilter === c.id ? c.avatar_color : `${c.avatar_color}22`,
                color: childFilter === c.id ? '#fff' : c.avatar_color,
              }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
                style={{ background: childFilter === c.id ? 'rgba(255,255,255,0.25)' : c.avatar_color, color: '#fff' }}>
                {c.name[0]}
              </span>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Lista de documentos */}
      {filtered.length === 0 ? (
        <div className="animate-fade-up flex flex-col items-center py-16 gap-3" style={{ color: 'rgba(26,43,28,0.35)' }}>
          <FileText size={40} strokeWidth={1.2} />
          <p className="text-sm italic">Nenhum documento nesta gaveta</p>
          {canEdit && (
            <button onClick={() => setShowUpload(true)}
              className="text-sm font-bold px-4 py-2 rounded-2xl transition-all hover:brightness-105"
              style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>
              Adicionar primeiro documento
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 animate-fade-up">
          {filtered.map(doc => {
            const status = expiryStatus(doc.expires_at)
            const child = doc.child
            const fileCount = doc.files?.length ?? 0
            return (
              <Link key={doc.id} href={`/vault/${category}/${doc.id}`}
                className="block transition-all hover:-translate-y-[1px]"
                style={{ textDecoration: 'none' }}>
                <div style={{ ...CARD, padding: '14px 16px', borderLeft: `4px solid ${meta.accent}` }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-sm truncate" style={{ color: '#1A2B1C' }}>{doc.title}</span>
                        {status && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: STATUS_STYLE[status].bg, color: STATUS_STYLE[status].color }}>
                            {STATUS_STYLE[status].label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {child && (
                          <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `${child.avatar_color}22`, color: child.avatar_color }}>
                            <span className="w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-black"
                              style={{ background: child.avatar_color, color: '#fff' }}>
                              {child.name[0]}
                            </span>
                            {child.name}
                          </span>
                        )}
                        {doc.expires_at && (
                          <span className="text-[11px] italic" style={{ color: 'rgba(26,43,28,0.40)' }}>
                            Vence {new Date(doc.expires_at).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                        {fileCount > 0 && (
                          <span className="text-[11px]" style={{ color: 'rgba(26,43,28,0.40)' }}>
                            {fileCount} arquivo{fileCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} color="rgba(26,43,28,0.30)" className="flex-shrink-0" />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Modal de upload */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => {
            if (e.target === e.currentTarget) {
              setShowUpload(false)
              setTitle(''); setDescription(''); setChildId(''); setTags(''); setFiles([])
              setOcrText(null); setOcrApplied(false); setDocType('outro'); setValues(seedDocValues('outro', {}))
              setFormStep('upload')
            }
          }}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4 animate-fade-up max-h-[90vh] overflow-y-auto"
            style={{ background: '#F5F0E8', border: '1px solid rgba(61,102,65,0.20)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>

            <div className="flex items-center justify-between">
              <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 20, fontWeight: 700, color: '#1A2B1C' }}>
                Novo documento — {meta.label}
              </h2>
              <button onClick={() => {
                setShowUpload(false)
                setTitle(''); setDescription(''); setChildId(''); setTags(''); setFiles([])
                setOcrText(null); setOcrApplied(false); setDocType('outro'); setValues(seedDocValues('outro', {}))
                setFormStep('upload')
              }} className="p-1 rounded-lg hover:bg-black/10 transition-colors">
                <X size={18} color="#1A2B1C" />
              </button>
            </div>

            <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR}
              className="hidden" onChange={e => handleFilesSelected(Array.from(e.target.files ?? []))} />

            {/* STEP 1 — Upload */}
            {formStep === 'upload' && (
              <div className="space-y-4">
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-3 py-10 rounded-2xl border-2 border-dashed transition-colors hover:bg-black/5"
                  style={{ borderColor: 'rgba(61,102,65,0.35)', color: '#3D6641' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(61,102,65,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Upload size={24} color="#3D6641" />
                  </div>
                  <div className="text-center">
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#2C4A2E' }}>Enviar foto ou PDF</p>
                    {canOcr && (
                      <p className="mt-1 flex items-center justify-center gap-1" style={{ fontSize: 12, color: 'rgba(26,43,28,0.55)' }}>
                        <Sparkles size={11} color="#3D6641" /> A IA detecta o tipo e preenche os campos
                      </p>
                    )}
                  </div>
                </button>
                <button type="button" onClick={() => setFormStep('form')}
                  className="w-full text-center text-sm font-semibold transition-colors hover:opacity-70"
                  style={{ color: 'rgba(26,43,28,0.45)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Preencher manualmente →
                </button>
              </div>
            )}

            {/* Loading OCR */}
            {ocrLoading && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 size={28} className="animate-spin" style={{ color: '#3D6641' }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: '#3D6641' }}>Lendo documento com IA…</p>
              </div>
            )}

            {/* STEP 2 — Formulário */}
            {formStep === 'form' && !ocrLoading && (
              <form onSubmit={handleUpload} className="space-y-3">

                {ocrApplied && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(61,102,65,0.10)' }}>
                    <Sparkles size={13} color="#3D6641" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#2C4A2E' }}>
                      IA detectou: {getDocType(docType).label} — confira os campos antes de salvar
                    </span>
                  </div>
                )}

                {/* Arquivos (compacto) */}
                <div>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed text-sm font-medium transition-colors hover:bg-black/5"
                    style={{ borderColor: 'rgba(61,102,65,0.30)', color: '#3D6641' }}>
                    <Upload size={14} />
                    {files.length > 0 ? `${files.length} arquivo${files.length > 1 ? 's' : ''} selecionado${files.length > 1 ? 's' : ''}` : 'Anexar arquivo (opcional)'}
                  </button>
                  {files.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(61,102,65,0.07)' }}>
                          <span className="truncate" style={{ color: '#1A2B1C' }}>{f.name}</span>
                          <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                            <X size={12} color="rgba(26,43,28,0.50)" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Natureza do documento</label>
                  <select className="input-field w-full" value={docType} onChange={e => changeDocType(e.target.value as DocType)}>
                    {DOC_TYPE_KEYS.map(k => <option key={k} value={k}>{getDocType(k).label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Título *</label>
                  <input className="input-field w-full" value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="Ex: Carteira de vacinação" required />
                </div>

                {children.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>{getDocType(docType).childLabel}</label>
                    <select className="input-field w-full" value={childId} onChange={e => setChildId(e.target.value)}>
                      <option value="">Todos os filhos</option>
                      {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Descrição</label>
                  <textarea className="input-field w-full resize-none" rows={2} value={description}
                    onChange={e => setDescription(e.target.value)} placeholder="Informações adicionais..." />
                </div>

                <DocFormFields docType={docType} values={values} onChange={(k, v) => setValues(prev => ({ ...prev, [k]: v }))} />

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Tags (separadas por vírgula)</label>
                  <input className="input-field w-full" value={tags} onChange={e => setTags(e.target.value)} placeholder="Ex: viagem, escola" />
                </div>

                <button type="submit" disabled={uploading}
                  className="w-full py-3 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
                  style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)' }}>
                  {uploading ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : 'Salvar documento'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
