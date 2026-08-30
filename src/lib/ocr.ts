// Helper client p/ OCR de documentos (cofre inteligente — v1b/v1c).
// Envia 1 ou 2 arquivos (frente+verso) ao endpoint, que classifica a NATUREZA
// do documento e devolve o texto + os campos comuns + os campos específicos do
// tipo (metadata) para auto-preenchimento do formulário.

import type { DocType } from './docTypes'
import { sniffFile, podeSerLido, materializarArquivos } from './fileSniff'

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

/**
 * O arquivo deve ser ENVIADO para o OCR? Decidido pelo CONTEÚDO.
 *
 * Esta era a raiz da divergência desktop × celular. A versão anterior olhava
 * `file.type` e a extensão do nome — os dois vindos do seletor de arquivos do
 * sistema. No desktop chegam preenchidos; no Android `file.type` vem vazio ou
 * "application/octet-stream" e alguns provedores entregam o nome sem
 * extensão. Com os dois vazios o arquivo era descartado AQUI, sem requisição,
 * sem ampulheta e sem aviso: parecia que a IA não existia no celular.
 *
 * Agora lê os primeiros bytes, que são idênticos em qualquer plataforma.
 * `file.type` só serve de atalho para evitar a leitura quando já é confiável.
 */
export async function isOcrable(file: File): Promise<boolean> {
  if (OCR_ACCEPTED_TYPES.includes(file.type)) return true
  return podeSerLido(await sniffFile(file))
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
    // `isOcrable` virou assíncrono porque lê o cabeçalho do arquivo.
    const elegiveis = await Promise.all(todos.map(isOcrable))
    const list = todos.filter((_, i) => elegiveis[i]).slice(0, 2)

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

    // Lê os bytes ANTES do fetch — ver materializarArquivos.
    let materializados: File[]
    try {
      materializados = await materializarArquivos(list)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      console.error('[ocr] falha ao ler bytes do arquivo:', e)
      onErro?.(`Não consegui ler o arquivo do seu aparelho (${m}). Tente copiá-lo para o celular antes de anexar, ou tire uma foto do documento.`)
      return null
    }

    const form = new FormData()
    materializados.forEach(f => form.append('files', f))

    // Tamanho e tempo entram na mensagem de erro porque "Failed to fetch" não
    // diz nada sozinho: falhar em 0,3s é rejeição imediata (corpo grande
    // demais barrado no caminho); falhar em 30s é conexão caindo no meio da
    // subida. Sem esses dois números, o diagnóstico vira adivinhação.
    const mb = (list.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)
    const t0 = Date.now()
    const seg = () => ((Date.now() - t0) / 1000).toFixed(1)

    const res = await fetch('/api/documents/ocr', { method: 'POST', body: form })
    if (!res.ok) {
      // 504/408 = estourou o tempo; 413 = corpo recusado por tamanho.
      const doServidor = await res.json().then(j => j?.error).catch(() => null)
      const motivo = res.status === 504 || res.status === 408
        ? `A leitura demorou demais (${seg()}s, ${mb} MB). Tente com uma conexão melhor ou um arquivo menor.`
        : res.status === 413
          ? `Arquivo grande demais para envio (${mb} MB).`
          : doServidor ?? `Falha na leitura (erro ${res.status}, ${seg()}s, ${mb} MB).`
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
    const tamanho = (todos.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)
    // A ORIGEM entra na mensagem porque é a diferença estrutural que sobrou
    // entre desktop e celular. O apex (familiaemdia.com.br) responde 308 para
    // o www — inclusive em /api. Uma página servida no apex faz fetch
    // relativo, cai no redirecionamento para OUTRO domínio, e isso vira
    // requisição entre origens: o `connect-src 'self'` do CSP barra e o
    // navegador reporta "Failed to fetch". Sem saber a origem, isso é
    // indistinguível de uma queda de rede.
    const origem = typeof window !== 'undefined' ? window.location.origin : '?'
    console.error('[ocr] excecao:', e, { origem })
    onErro?.(`Falha ao ler (${msg}) — ${tamanho} MB — origem: ${origem}`)
    return null
  }
}
