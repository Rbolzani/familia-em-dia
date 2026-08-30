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

// Formatos que o OCR comprovadamente NÃO lê: documentos de escritório e texto
// puro. Tudo o mais (foto, PDF, e o que o celular reportar mal) vai para o
// servidor decidir.
const NAO_OCRAVEIS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'txt']

/**
 * O arquivo deve ser ENVIADO para o OCR?
 *
 * Antes esta função era uma LISTA DE PERMISSÃO: só passava quem tivesse
 * `file.type` conhecido ou extensão conhecida. Isso a tornava mais restrita
 * que o próprio servidor — que detecta PDF pelos magic bytes e normaliza
 * imagem por extensão. Seletores de arquivo no Android costumam entregar
 * `file.type` vazio, e alguns provedores entregam o nome sem extensão; nesses
 * casos os dois critérios falhavam e o arquivo era descartado AQUI, sem
 * requisição, sem ampulheta e sem aviso. Do lado do usuário parecia que a IA
 * simplesmente não existia no celular.
 *
 * Invertida para LISTA DE BLOQUEIO: barra o que sabidamente não é legível e
 * deixa o resto chegar ao servidor, que tem o conteúdo em mãos para decidir.
 * O custo de errar para mais é uma chamada que volta 400; o de errar para
 * menos era a funcionalidade inteira sumir sem explicação.
 */
export function isOcrable(file: File): boolean {
  if (OCR_ACCEPTED_TYPES.includes(file.type)) return true
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (OCR_ACCEPTED_EXTS.includes(ext)) return true
  return !NAO_OCRAVEIS.includes(ext)
}

// Chama /api/documents/ocr com até 2 arquivos (frente+verso). Retorna null em
// qualquer falha (auto-preenchimento é conveniência: nunca quebra o upload).
/**
 * `onErro` existe porque esta função engolia TODA falha e devolvia null — o
 * formulário abria em branco e a leitura parecia nunca ter acontecido. Foi o
 * que escondeu, por semanas, o fato de o OCR não funcionar no celular.
 * Quem chama passa o toast; o motivo vem do servidor quando existir.
 */
export async function ocrDocument(
  files: File | File[],
  onErro?: (motivo: string) => void,
): Promise<OcrResult | null> {
  const todos = Array.isArray(files) ? files : [files]
  try {
    const list = todos.filter(isOcrable).slice(0, 2)

    // Descarte ANTES da requisição. Era a saída mais silenciosa da função:
    // sem requisição não há espera, então nem a ampulheta chega a aparecer —
    // o arquivo só anexa e o formulário abre, como se a IA não existisse.
    //
    // `isOcrable` decide por `file.type` OU pela extensão. Seletores de
    // arquivo no Android costumam entregar `file.type` vazio, e alguns
    // provedores entregam o nome sem extensão — aí os dois critérios falham.
    // A mensagem nomeia o que o navegador reportou, para o caso não virar
    // adivinhação de novo.
    if (list.length === 0) {
      const d = todos.map(f => `${f.name || '(sem nome)'} [${f.type || 'tipo vazio'}]`).join(', ')
      console.warn('[ocr] nenhum arquivo elegivel:', d)
      onErro?.(`A IA não consegue ler este arquivo (${d}). Preencha os campos manualmente.`)
      return null
    }

    const form = new FormData()
    list.forEach(f => form.append('files', f))
    const res = await fetch('/api/documents/ocr', { method: 'POST', body: form })
    if (!res.ok) {
      // 504 = a função estourou o tempo (rede lenta subindo arquivo grande).
      const motivo = res.status === 504 || res.status === 408
        ? 'A leitura demorou demais. Tente com uma conexão melhor ou um arquivo menor.'
        : await res.json().then(j => j?.error).catch(() => null)
          ?? `Falha na leitura (erro ${res.status}).`
      onErro?.(motivo)
      return null
    }
    const json = await res.json()
    if (typeof json?.ocr_text !== 'string') {
      console.warn('[ocr] resposta sem ocr_text:', json)
      onErro?.('A IA respondeu, mas sem texto legível. Preencha os campos manualmente.')
      return null
    }
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
  } catch (e) {
    // A rede falhando (conexão caindo, requisição abortada ao trocar de app
    // no celular, função encerrada no meio) chegava aqui e era engolida sem
    // deixar rastro. Silêncio é o pior resultado possível num diagnóstico.
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ocr] excecao:', e)
    onErro?.(`Falha de conexão ao ler o documento (${msg}).`)
    return null
  }
}
