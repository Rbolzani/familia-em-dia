// Tipos de arquivo aceitos no cofre.
//
// POR QUE ISTO EXISTE
// A rota de upload aceitava qualquer coisa e gravava o `content-type` que o
// CLIENTE mandasse. Teste O6, em produção: SVG com <script>, HTML puro e um
// executável renomeado para .pdf foram todos aceitos com 200.
//
// Nenhum deles chegou a executar — mas por mérito do Supabase Storage, não do
// nosso código: ele serve SVG com `Content-Disposition: attachment` e rebaixa
// `text/html` para `text/plain`. Isso é uma dependência silenciosa: trocar de
// provedor, ou o provedor mudar esse comportamento, reabre o buraco sem uma
// linha do nosso repositório mudar.
//
// O risco concreto aqui não é XSS, é distribuição: um parceiro com acesso
// completo sobe um executável e o outro responsável baixa e abre, confiando
// porque "veio do cofre da família".

/** MIME canônico por extensão. A extensão é a chave porque é o que o usuário vê. */
const PERMITIDOS: Record<string, string> = {
  pdf:  'application/pdf',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  bmp:  'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt:  'application/vnd.oasis.opendocument.text',
  txt:  'text/plain',
}

/** Lista para o atributo `accept` do <input type="file">. */
export const ACCEPT_ATTR = Object.keys(PERMITIDOS).map(e => `.${e}`).join(',')

export const EXTENSOES_PERMITIDAS = Object.keys(PERMITIDOS)

/** Teto por arquivo. A cota da família continua valendo por cima disto. */
export const TAMANHO_MAXIMO_BYTES = 25 * 1024 * 1024

/**
 * Confere a assinatura (magic bytes) do conteúdo.
 *
 * A extensão e o `file.type` vêm do cliente e são forjáveis — foi exatamente
 * assim que o executável entrou como `application/pdf` no teste. Só o
 * conteúdo não mente.
 *
 * `txt` não tem assinatura e fica de fora da checagem por definição; ele é
 * servido como `text/plain`, que não executa.
 */
function assinaturaBate(ext: string, b: Uint8Array): boolean {
  const inicia = (...bytes: number[]) => bytes.every((x, i) => b[i] === x)

  switch (ext) {
    case 'pdf':
      return inicia(0x25, 0x50, 0x44, 0x46)                       // %PDF
    case 'png':
      return inicia(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    case 'jpg': case 'jpeg':
      return inicia(0xFF, 0xD8, 0xFF)
    case 'bmp':
      return inicia(0x42, 0x4D)                                   // BM
    case 'webp':
      // RIFF....WEBP — os 4 bytes do meio são o tamanho, variam.
      return inicia(0x52, 0x49, 0x46, 0x46) &&
             b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    case 'heic': case 'heif':
      // Caixa ISO-BMFF: 4 bytes de tamanho, depois 'ftyp'.
      return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
    case 'docx': case 'xlsx': case 'pptx': case 'odt':
      return inicia(0x50, 0x4B, 0x03, 0x04)                       // PK — zip
    case 'doc': case 'xls': case 'ppt':
      // OLE2 (Office 97-2003)
      return inicia(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)
    case 'txt':
      return true
    default:
      return false
  }
}

export interface ArquivoValidado {
  ok: true
  /** MIME derivado da NOSSA tabela — nunca o que o cliente mandou. */
  contentType: string
}
export interface ArquivoRejeitado {
  ok: false
  motivo: string
}

/**
 * Valida um arquivo do cofre. Recebe os bytes porque a assinatura é a única
 * checagem que o cliente não controla.
 */
export function validarArquivo(nome: string, tamanho: number, bytes: Uint8Array)
  : ArquivoValidado | ArquivoRejeitado {

  if (tamanho > TAMANHO_MAXIMO_BYTES) {
    return { ok: false, motivo:
      `"${nome}" tem mais de ${TAMANHO_MAXIMO_BYTES / (1024 * 1024)} MB.` }
  }

  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  const canonico = PERMITIDOS[ext]
  if (!canonico) {
    return { ok: false, motivo:
      `Formato não aceito: "${nome}". Aceitos: ${EXTENSOES_PERMITIDAS.join(', ')}.` }
  }

  if (!assinaturaBate(ext, bytes)) {
    return { ok: false, motivo:
      `"${nome}" não é um arquivo ${ext.toUpperCase()} válido — o conteúdo não corresponde à extensão.` }
  }

  return { ok: true, contentType: canonico }
}
