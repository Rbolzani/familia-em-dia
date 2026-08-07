'use client'
import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Download, Trash2, Plus, FileText, Image, File, Loader2, X, Upload, AlertTriangle, Eye, Pencil } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { Child, AppDocument, DocumentFile, DocumentCategory } from '@/lib/types'
import { useAccess } from '@/components/access/AccessContext'
import { getVaultCategory, VAULT_CATEGORIES, expiryStatus as vaultExpiryStatus, EXPIRY_META, expiryLabel } from '@/lib/vault'
import { getDocType, seedDocValues, splitDocValues, DOC_TYPE_KEYS, type DocType, type VacinaItem } from '@/lib/docTypes'
import DocFormFields from '@/components/vault/DocFormFields'
import { applyDoseReminders } from '@/lib/doseReminders'

function fileIcon(mime: string | null) {
  if (!mime) return <File size={18} />
  if (mime.startsWith('image/')) return <Image size={18} />
  if (mime === 'application/pdf') return <FileText size={18} />
  return <File size={18} />
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function expiryStatus(expires_at: string | null): { label: string; bg: string; color: string } | null {
  if (!expires_at) return null
  const d = new Date(expires_at)
  const now = new Date()
  if (d < now) return { label: 'Vencido', bg: 'rgba(239,68,68,0.12)', color: '#B91C1C' }
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diff <= 30) return { label: 'Vence em breve', bg: 'rgba(245,158,11,0.12)', color: '#92400E' }
  return { label: 'Válido', bg: 'rgba(16,185,129,0.12)', color: '#065F46' }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  return new Date(String(s) + 'T00:00:00').toLocaleDateString('pt-BR')
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: '1px solid rgba(61,102,65,0.06)' }}>
      <span className="flex-shrink-0" style={{ color: 'rgba(26,43,28,0.50)' }}>{label}</span>
      <span className="text-right font-semibold break-words" style={{ color: color ?? '#1A2B1C', maxWidth: '55%', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

// Lista de vacinas com status da PRÓXIMA DOSE (alerta de agendamento por vacina).
function VacinasView({ items }: { items: VacinaItem[] }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Vacinas</p>
      <div className="space-y-2">
        {items.map((v, i) => {
          return (
            <div key={i} className="rounded-xl p-2.5" style={{ background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.12)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm" style={{ color: '#1A2B1C' }}>{v.nome || 'Vacina'}</span>
                {v.dose && <span className="text-[11px]" style={{ color: 'rgba(26,43,28,0.50)' }}>{v.dose}</span>}
              </div>
              <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
                <span className="text-[11.5px]" style={{ color: 'rgba(26,43,28,0.55)' }}>
                  {v.data_aplicacao ? `Aplicada em ${fmtDate(v.data_aplicacao)}` : 'Sem data de aplicação'}
                </span>
                {/* Sem selo de vencimento: a lista é o HISTÓRICO do cartão.
                    Dose faltante vira lembrete no mural, não alarme aqui. */}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  document: AppDocument
  category: DocumentCategory
  children: Child[]
}

export default function DocumentDetailClient({ document: doc, category, children }: Props) {
  const router = useRouter()
  const { canEdit } = useAccess()
  const cat = getVaultCategory(category)
  const meta = { label: cat?.label ?? category, accent: cat?.accent ?? '#3D6641' }
  const [files, setFiles] = useState<DocumentFile[]>(doc.files ?? [])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const [deletingDoc, setDeletingDoc] = useState(false)
  const [uploadingMore, setUploadingMore] = useState(false)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [showAddFiles, setShowAddFiles] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [preview, setPreview] = useState<{ url: string; mime: string | null; name: string } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<DocumentFile | null>(doc.files?.[0] ?? null)
  const [inlineUrl, setInlineUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Edição dos dados cadastrais
  const [showEdit, setShowEdit]       = useState(false)
  const [savingEdit, setSavingEdit]   = useState(false)
  const [eTitle, setETitle]           = useState(doc.title)
  const [eDescription, setEDescription] = useState(doc.description ?? '')
  const [eChildId, setEChildId]       = useState(doc.child?.id ?? '')
  const [eCategory, setECategory]     = useState<DocumentCategory>(category)
  const [eTags, setETags]             = useState((doc.tags ?? []).join(', '))
  const [eDocType, setEDocType]       = useState<DocType>((doc.doc_type as DocType) ?? 'outro')
  const [eValues, setEValues]         = useState<Record<string, unknown>>(() => seedDocValues((doc.doc_type as DocType) ?? 'outro', doc))

  function openEdit() {
    setETitle(doc.title)
    setEDescription(doc.description ?? '')
    setEChildId(doc.child?.id ?? '')
    setECategory(category)
    setETags((doc.tags ?? []).join(', '))
    const t = (doc.doc_type as DocType) ?? 'outro'
    setEDocType(t)
    setEValues(seedDocValues(t, doc))
    setShowEdit(true)
  }

  // Troca de natureza na edição: re-seeda preservando comuns + ajusta a gaveta.
  function changeEDocType(nt: DocType) {
    setEValues(prev => seedDocValues(nt, {
      doc_number: prev.doc_number as string ?? null,
      issuer: prev.issuer as string ?? null,
      issue_date: prev.issue_date as string ?? null,
      expires_at: prev.expires_at as string ?? null,
      metadata: prev,
    }))
    setEDocType(nt)
    setECategory(getDocType(nt).category)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!eTitle.trim()) { toast('Informe o título do documento', 'error'); return }
    setSavingEdit(true)
    try {
      const { columns, metadata } = splitDocValues(eDocType, eValues)
      // Cria os lembretes de dose faltante e tira `doses_pendentes` do
      // metadata antes do PATCH, para não duplicar numa edição futura.
      const lembretes = await applyDoseReminders({
        docType: eDocType, values: eValues, metadata,
        docTitle: eTitle.trim(), childId: eChildId || null,
      })
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: eTitle, description: eDescription, child_id: eChildId,
          category: eCategory, tags: eTags, doc_type: eDocType,
          doc_number: columns.doc_number ?? null, issuer: columns.issuer ?? null,
          issue_date: columns.issue_date ?? null, expires_at: columns.expires_at ?? null,
          metadata,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast(json.error ?? 'Erro ao salvar', 'error'); return }
      toast(lembretes > 0
        ? `Documento atualizado ✓ · ${lembretes === 1 ? '1 lembrete criado' : `${lembretes} lembretes criados`} no mural`
        : 'Documento atualizado ✓')
      setShowEdit(false)
      // Se mudou de gaveta, navega para a nova URL; senão recarrega os dados.
      if (eCategory !== category) router.push(`/vault/${eCategory}/${doc.id}`)
      else router.refresh()
    } catch {
      toast('Erro ao salvar', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  // Carrega o preview inline — só para IMAGENS (PDF usa placeholder + nova aba).
  useEffect(() => {
    if (!previewFile || !previewFile.mime_type?.startsWith('image/')) { setInlineUrl(null); return }
    setInlineUrl(null)
    let active = true
    fetch(`/api/documents/${doc.id}/signed-url?fileId=${previewFile.id}`)
      .then(r => r.json())
      .then(j => { if (active && j.url) setInlineUrl(j.url) })
      .catch(() => {})
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFile?.id])

  async function viewFile(file: DocumentFile) {
    setPreviewing(file.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/signed-url?fileId=${file.id}`)
      const json = await res.json()
      if (!res.ok) { toast(json.error ?? 'Erro ao abrir', 'error'); return }
      // PDF: abre em nova aba (visualizador nativo do navegador — sempre funciona).
      // Imagem: lightbox embutido.
      if (file.mime_type === 'application/pdf') window.open(json.url, '_blank')
      else setPreview({ url: json.url, mime: file.mime_type, name: file.file_name })
    } catch {
      toast('Erro ao abrir arquivo', 'error')
    } finally {
      setPreviewing(null)
    }
  }

  const child = doc.child
  const status = expiryStatus(doc.expires_at)

  // Campos para exibição, derivados da natureza do documento (v1c).
  const typeDef = getDocType(doc.doc_type)
  const metaRows: { label: string; value: string }[] = []
  let vacinas: VacinaItem[] = []
  for (const f of typeDef.fields) {
    if (f.format === 'vacinas') { vacinas = (doc.metadata?.[f.key] as VacinaItem[]) ?? []; continue }
    const raw = f.column ? (doc as unknown as Record<string, unknown>)[f.column] : doc.metadata?.[f.key]
    if (raw == null || raw === '') continue
    const value = f.format === 'data' ? fmtDate(String(raw)) : f.format === 'sim_nao' ? (raw ? 'Sim' : 'Não') : String(raw)
    metaRows.push({ label: f.label, value })
  }

  async function downloadFile(file: DocumentFile) {
    setDownloading(file.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/signed-url?fileId=${file.id}`)
      const json = await res.json()
      if (!res.ok) { toast(json.error ?? 'Erro ao gerar link', 'error'); return }
      window.open(json.url, '_blank')
    } catch {
      toast('Erro ao baixar arquivo', 'error')
    } finally {
      setDownloading(null)
    }
  }

  async function deleteFile(file: DocumentFile) {
    setDeletingFile(file.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/files?fileId=${file.id}`, { method: 'DELETE' })
      if (!res.ok) { toast('Erro ao remover arquivo', 'error'); return }
      setFiles(prev => {
        const next = prev.filter(f => f.id !== file.id)
        if (previewFile?.id === file.id) setPreviewFile(next[0] ?? null)
        return next
      })
      toast('Arquivo removido')
    } catch {
      toast('Erro ao remover arquivo', 'error')
    } finally {
      setDeletingFile(null)
    }
  }

  async function uploadMoreFiles(e: React.FormEvent) {
    e.preventDefault()
    if (!newFiles.length) return
    setUploadingMore(true)
    try {
      const form = new FormData()
      newFiles.forEach(f => form.append('files', f))
      const res = await fetch(`/api/documents/${doc.id}/files`, { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { toast(json.error ?? 'Erro no upload', 'error'); return }
      const added: DocumentFile[] = json.files
      setFiles(prev => {
        const next = [...prev, ...added]
        if (!previewFile && next.length > 0) setPreviewFile(next[0])
        return next
      })
      setNewFiles([])
      setShowAddFiles(false)
      toast('Arquivos adicionados ✓')
    } catch {
      toast('Erro no upload', 'error')
    } finally {
      setUploadingMore(false)
    }
  }

  async function deleteDocument() {
    setDeletingDoc(true)
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) { toast('Erro ao excluir documento', 'error'); setDeletingDoc(false); return }
      toast('Documento excluído')
      router.push(`/vault/${category}`)
    } catch {
      toast('Erro ao excluir documento', 'error')
      setDeletingDoc(false)
    }
  }

  const CARD: React.CSSProperties = {
    background: 'linear-gradient(160deg,#FFFFFF 0%,#F5F0E8 100%)',
    border: '1px solid rgba(61,102,65,0.18)',
    boxShadow: '0 4px 16px rgba(44,74,46,0.08),0 1px 4px rgba(44,74,46,0.05)',
    borderRadius: 16,
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4 overflow-x-hidden">

      {/* Breadcrumb — links fixos, título truncado */}
      <div className="flex items-center gap-1.5 text-sm animate-fade-up min-w-0 overflow-hidden">
        <Link href="/vault" style={{ color: '#3D6641', textDecoration: 'none', flexShrink: 0 }} className="hover:opacity-70 transition-opacity">
          Documentos
        </Link>
        <span style={{ color: 'rgba(26,43,28,0.30)', flexShrink: 0 }}>/</span>
        <Link href={`/vault/${category}`} style={{ color: '#3D6641', textDecoration: 'none', flexShrink: 0 }} className="hover:opacity-70 transition-opacity">
          {meta.label}
        </Link>
        <span style={{ color: 'rgba(26,43,28,0.30)', flexShrink: 0 }}>/</span>
        <span className="font-bold truncate" style={{ color: '#1A2B1C', minWidth: 0 }}>{doc.title}</span>
      </div>

      {/* Hero — coluna única no mobile, lado a lado no desktop */}
      <div className="animate-fade-up flex flex-col md:flex-row gap-4" style={{ minWidth: 0 }}>

        {/* Preview inline do arquivo selecionado — só no desktop.
            No mobile a lista de arquivos abaixo (com Visualizar/Baixar/Excluir) basta. */}
        <div className="hidden md:block" style={{ ...CARD, padding: 14, minWidth: 0, flex: '1 1 0' }}>
          <div style={{ height: 240, borderRadius: 12, overflow: 'hidden', background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {previewFile && inlineUrl && previewFile.mime_type?.startsWith('image/') ? (
              <img src={inlineUrl} alt={previewFile.file_name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : previewFile && previewFile.mime_type === 'application/pdf' ? (
              // PDF: placeholder limpo (iframe cross-origin é instável); "Visualizar" abre em nova aba.
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <FileText size={42} strokeWidth={1.2} color="#B91C1C" />
                <span className="text-xs font-semibold break-words" style={{ color: '#1A2B1C', maxWidth: '90%' }}>{previewFile.file_name}</span>
                <span className="text-[11px]" style={{ color: 'rgba(26,43,28,0.45)' }}>PDF · toque em Visualizar para abrir</span>
              </div>
            ) : previewFile ? (
              <div className="flex flex-col items-center gap-2" style={{ color: 'rgba(26,43,28,0.35)' }}>
                <Loader2 size={28} className="animate-spin" />
                <span className="text-xs">Carregando…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2" style={{ color: 'rgba(26,43,28,0.35)' }}>
                <FileText size={40} strokeWidth={1.2} />
                <span className="text-xs">Sem arquivo anexado</span>
              </div>
            )}
          </div>

          {/* Thumbnails — só aparece quando há mais de 1 arquivo */}
          {files.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {files.map((file, idx) => (
                <button key={file.id} onClick={() => setPreviewFile(file)}
                  className="flex-shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-all"
                  style={{
                    background: previewFile?.id === file.id ? 'rgba(61,102,65,0.15)' : 'rgba(61,102,65,0.05)',
                    border: previewFile?.id === file.id ? '1.5px solid rgba(61,102,65,0.40)' : '1px solid rgba(61,102,65,0.10)',
                    minWidth: 56,
                  }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: '#3D6641' }}>
                    {fileIcon(file.mime_type)}
                  </div>
                  <span className="text-[10px] font-medium" style={{ color: 'rgba(26,43,28,0.55)', maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Arquivo {idx + 1}
                  </span>
                </button>
              ))}
            </div>
          )}

          {previewFile && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => viewFile(previewFile)} disabled={previewing === previewFile.id}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-105 active:scale-95"
                style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)' }}>
                {previewing === previewFile.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Visualizar
              </button>
              <button onClick={() => downloadFile(previewFile)} disabled={downloading === previewFile.id}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-95"
                style={{ background: '#fff', border: '1px solid rgba(61,102,65,0.22)', color: '#3D6641' }}>
                {downloading === previewFile.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Baixar
              </button>
            </div>
          )}
        </div>

        {/* Dados do documento — altura natural no mobile (flex-col); coluna igual só no desktop.
            Sem overflow:hidden + flex:1 1 0 no eixo vertical (colapsava a altura no mobile). */}
        <div className="w-full min-w-0 md:flex-1" style={{ ...CARD, padding: 18, borderLeft: `4px solid ${meta.accent}` }}>
          <div className="flex items-start gap-2 flex-wrap mb-3">
            <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 21, fontWeight: 700, color: '#1A2B1C', flex: 1, minWidth: 0 }}>
              {doc.title}
            </h1>
            {status && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: status.bg, color: status.color }}>
                {status.label}
              </span>
            )}
          </div>
          {doc.description && (
            <p className="text-sm mb-3 italic" style={{ color: 'rgba(26,43,28,0.55)' }}>{doc.description}</p>
          )}
          {/* Metadados — dinâmico por natureza (v1c) */}
          <div className="text-sm" style={{ borderTop: '1px solid rgba(61,102,65,0.10)' }}>
            <Row label="Categoria" value={meta.label} color={meta.accent} />
            <Row label="Natureza" value={typeDef.label} />
            <Row label={typeDef.childLabel} value={child?.name ?? 'Família'} />
            {metaRows.map(r => <Row key={r.label} label={r.label} value={r.value} color={r.label.toLowerCase().includes('vencimento') || r.label.toLowerCase().includes('validade') ? (status?.color ?? '#1A2B1C') : '#1A2B1C'} />)}
            {doc.tags && doc.tags.length > 0 && (
              <div className="flex items-start justify-between gap-3 py-2">
                <span className="flex-shrink-0" style={{ color: 'rgba(26,43,28,0.50)' }}>Tags</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {doc.tags.map(t => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>{t}</span>)}
                </div>
              </div>
            )}
          </div>
          {vacinas.length > 0 && <VacinasView items={vacinas} />}
          {canEdit && (
            <button onClick={openEdit}
              className="mt-3 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all hover:brightness-105 active:scale-95"
              style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>
              <Pencil size={13} /> Editar informações
            </button>
          )}
        </div>
      </div>

      {/* Arquivos */}
      <div className="animate-fade-up" style={{ ...CARD, overflow: 'hidden' }}>
        <div className="flex items-center justify-between gap-2 p-4 pb-0 mb-3">
          <h2 className="font-bold text-sm flex-shrink-0" style={{ color: '#1A2B1C' }}>Arquivos ({files.length})</h2>
          {canEdit && (
            <button onClick={() => setShowAddFiles(true)}
              className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl transition-all hover:brightness-105 active:scale-95 flex-shrink-0"
              style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>
              <Plus size={13} />
              Adicionar
            </button>
          )}
        </div>

        {files.length === 0 ? (
          <div className="px-4 pb-4 flex flex-col items-center py-8 gap-2" style={{ color: 'rgba(26,43,28,0.35)' }}>
            <File size={32} strokeWidth={1.2} />
            <p className="text-xs italic">Nenhum arquivo anexado</p>
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-2">
            {files.map(file => (
              <div key={file.id} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.10)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(61,102,65,0.10)', color: '#3D6641' }}>
                  {fileIcon(file.mime_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: '#1A2B1C' }}>{file.file_name}</div>
                  {file.file_size && (
                    <div className="text-xs" style={{ color: 'rgba(26,43,28,0.45)' }}>{formatBytes(file.file_size)}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => viewFile(file)}
                    disabled={previewing === file.id}
                    className="p-1.5 rounded-lg transition-colors hover:bg-black/10 disabled:opacity-50"
                    title="Visualizar">
                    {previewing === file.id ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} color="#3D6641" />}
                  </button>
                  <button onClick={() => downloadFile(file)}
                    disabled={downloading === file.id}
                    className="p-1.5 rounded-lg transition-colors hover:bg-black/10 disabled:opacity-50"
                    title="Download">
                    {downloading === file.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} color="#3D6641" />}
                  </button>
                  {canEdit && (
                    <button onClick={() => deleteFile(file)}
                      disabled={deletingFile === file.id}
                      className="p-1.5 rounded-lg transition-colors hover:bg-red-50 disabled:opacity-50"
                      title="Remover">
                      {deletingFile === file.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} color="#EF4444" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Zona de perigo */}
      {canEdit && (
      <div className="animate-fade-up p-4 rounded-2xl" style={{ border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.04)' }}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} color="#EF4444" />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#EF4444' }}>Zona de perigo</span>
        </div>
        <p className="text-xs mb-3" style={{ color: 'rgba(26,43,28,0.55)' }}>
          Esta ação é permanente e removerá o documento e todos os arquivos associados.
        </p>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="text-sm font-bold px-4 py-2 rounded-xl transition-all hover:bg-red-50"
            style={{ color: '#EF4444', border: '1px solid rgba(239,68,68,0.30)' }}>
            Excluir documento
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={deleteDocument} disabled={deletingDoc}
              className="text-sm font-bold px-4 py-2 rounded-xl text-white flex items-center gap-1.5 disabled:opacity-60 transition-all"
              style={{ background: '#EF4444' }}>
              {deletingDoc ? <><Loader2 size={13} className="animate-spin" /> Excluindo...</> : 'Confirmar exclusão'}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-sm font-bold px-4 py-2 rounded-xl transition-all hover:bg-black/10"
              style={{ color: 'rgba(26,43,28,0.60)' }}>
              Cancelar
            </button>
          </div>
        )}
      </div>
      )}

      {/* Modal adicionar arquivos */}
      {showAddFiles && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAddFiles(false) }}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4 animate-fade-up"
            style={{ background: '#F5F0E8', border: '1px solid rgba(61,102,65,0.20)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div className="flex items-center justify-between">
              <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 18, fontWeight: 700, color: '#1A2B1C' }}>
                Adicionar arquivos
              </h2>
              <button onClick={() => setShowAddFiles(false)} className="p-1 rounded-lg hover:bg-black/10 transition-colors">
                <X size={18} color="#1A2B1C" />
              </button>
            </div>
            <form onSubmit={uploadMoreFiles} className="space-y-3">
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden" onChange={e => setNewFiles(Array.from(e.target.files ?? []))} />
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed text-sm font-medium transition-colors hover:bg-black/5"
                style={{ borderColor: 'rgba(61,102,65,0.30)', color: '#3D6641' }}>
                <Upload size={16} />
                {newFiles.length > 0 ? `${newFiles.length} arquivo${newFiles.length > 1 ? 's' : ''} selecionado${newFiles.length > 1 ? 's' : ''}` : 'Selecionar arquivos'}
              </button>
              {newFiles.length > 0 && (
                <div className="space-y-1">
                  {newFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded-lg"
                      style={{ background: 'rgba(61,102,65,0.07)' }}>
                      <span className="truncate" style={{ color: '#1A2B1C' }}>{f.name}</span>
                      <button type="button" onClick={() => setNewFiles(prev => prev.filter((_, j) => j !== i))}>
                        <X size={12} color="rgba(26,43,28,0.50)" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button type="submit" disabled={uploadingMore || !newFiles.length}
                className="w-full py-3 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
                style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)' }}>
                {uploadingMore ? <><Loader2 size={15} className="animate-spin" /> Enviando...</> : 'Enviar arquivos'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal de edição dos dados */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowEdit(false) }}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4 animate-fade-up max-h-[90vh] overflow-y-auto"
            style={{ background: '#F5F0E8', border: '1px solid rgba(61,102,65,0.20)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div className="flex items-center justify-between">
              <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 20, fontWeight: 700, color: '#1A2B1C' }}>
                Editar documento
              </h2>
              <button onClick={() => setShowEdit(false)} className="p-1 rounded-lg hover:bg-black/10 transition-colors">
                <X size={18} color="#1A2B1C" />
              </button>
            </div>

            <form onSubmit={handleEditSave} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Natureza do documento</label>
                <select className="input-field w-full" value={eDocType} onChange={e => changeEDocType(e.target.value as DocType)}>
                  {DOC_TYPE_KEYS.map(k => <option key={k} value={k}>{getDocType(k).label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Gaveta *</label>
                <select className="input-field w-full" value={eCategory} onChange={e => setECategory(e.target.value as DocumentCategory)}>
                  {VAULT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Título *</label>
                <input className="input-field w-full" value={eTitle} onChange={e => setETitle(e.target.value)} required />
              </div>

              {children.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>{getDocType(eDocType).childLabel}</label>
                  <select className="input-field w-full" value={eChildId} onChange={e => setEChildId(e.target.value)}>
                    <option value="">Todos os filhos</option>
                    {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Descrição</label>
                <textarea className="input-field w-full resize-none" rows={2} value={eDescription} onChange={e => setEDescription(e.target.value)} />
              </div>

              {/* Campos específicos da natureza (dinâmico) */}
              <DocFormFields docType={eDocType} values={eValues} onChange={(k, v) => setEValues(prev => ({ ...prev, [k]: v }))} />

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,43,28,0.50)' }}>Tags (separadas por vírgula)</label>
                <input className="input-field w-full" value={eTags} onChange={e => setETags(e.target.value)} placeholder="Ex: viagem, escola" />
              </div>

              <button type="submit" disabled={savingEdit}
                className="w-full py-3 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
                style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)' }}>
                {savingEdit ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : 'Salvar alterações'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Visualizador (lightbox) */}
      {preview && (
        <div className="fixed inset-0 z-[100] flex flex-col"
          style={{ background: 'rgba(10,18,11,0.92)' }}
          onClick={() => setPreview(null)}>
          <div className="flex items-center justify-between px-4 py-3" style={{ color: '#fff' }}>
            <span className="text-sm font-medium truncate" style={{ maxWidth: '70%' }}>{preview.name}</span>
            <div className="flex items-center gap-3">
              <a href={preview.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                className="text-sm flex items-center gap-1" style={{ color: '#D4E8D5' }}>
                <Download size={15} /> Baixar
              </a>
              <button onClick={() => setPreview(null)} aria-label="Fechar"><X size={22} color="#fff" /></button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
            {preview.mime?.startsWith('image/') ? (
              <img src={preview.url} alt={preview.name}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
            ) : preview.mime === 'application/pdf' ? (
              <iframe src={preview.url} title={preview.name}
                style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#fff' }} />
            ) : (
              <div className="text-center" style={{ color: '#D4E8D5' }}>
                <File size={48} strokeWidth={1.2} className="mx-auto mb-3" />
                <p className="text-sm">Pré-visualização não disponível para este tipo de arquivo.</p>
                <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm underline mt-2 inline-block">Abrir / baixar</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
