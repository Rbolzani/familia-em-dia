// Helper client p/ OCR de documentos (cofre inteligente — v1b/v1c).
// Envia 1 ou 2 arquivos (frente+verso) ao endpoint, que classifica a NATUREZA
// do documento e devolve o texto + os campos comuns + os campos específicos do
// tipo (metadata) para auto-preenchimento do formulário.

import type { DocType } from './docTypes'

export interface OcrResult {
  ocr_text: string
  doc_type: DocType | null
  // Campos comuns (mapeiam a colunas de `documents`)
  title: string | null
  description: string | null
  doc_number: string | null
  issuer: string | null
  issue_date: string | null   // YYYY-MM-DD
  expires_at: string | null   // YYYY-MM-DD
  // Campos específicos do tipo (chave→valor conforme docTypes)
  metadata: Record<string, unknown>
}

// Tipos aceitos para OCR (imagens + PDF).
//
// HEIC/HEIF entram na lista porque é o formato padrão da câmera do iPhone: o
// servidor converte para JPEG em `normalizeImage` antes de chamar a Claude
// Vision. Sem eles aqui, o filtro do cliente descartava a foto e o OCR não
// rodava — silenciosamente, já que `ocrDocument` devolve null em qualquer
// falha.
export const OCR_ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
]

// Extensões equivalentes: o iOS às vezes entrega `file.type` vazio ou
// `application/octet-stream`, e aí só o nome do arquivo identifica o formato.
const OCR_ACCEPTED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'heic', 'heif']

// Valor do `accept` dos inputs de arquivo — mantido junto da lista de tipos
// para os dois não saírem de sincronia.
export const OCR_ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif'

export function isOcrable(file: File): boolean {
  if (OCR_ACCEPTED_TYPES.includes(file.type)) return true
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  return OCR_ACCEPTED_EXTS.includes(ext)
}

// Chama /api/documents/ocr com até 2 arquivos (frente+verso). Retorna null em
// qualquer falha (auto-preenchimento é conveniência: nunca quebra o upload).
export async function ocrDocument(files: File | File[]): Promise<OcrResult | null> {
  try {
    const list = (Array.isArray(files) ? files : [files]).filter(isOcrable).slice(0, 2)
    if (list.length === 0) return null
    const form = new FormData()
    list.forEach(f => form.append('files', f))
    const res = await fetch('/api/documents/ocr', { method: 'POST', body: form })
    if (!res.ok) return null
    const json = await res.json()
    if (typeof json?.ocr_text !== 'string') return null
    return {
      ocr_text: json.ocr_text,
      doc_type: json.doc_type ?? null,
      title: json.title ?? null,
      description: json.description ?? null,
      doc_number: json.doc_number ?? null,
      issuer: json.issuer ?? null,
      issue_date: json.issue_date ?? null,
      expires_at: json.expires_at ?? null,
      metadata: (json.metadata && typeof json.metadata === 'object') ? json.metadata : {},
    }
  } catch {
    return null
  }
}
