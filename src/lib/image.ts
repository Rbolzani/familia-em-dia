// Server-only: normaliza imagens enviadas pelo usuário para um dos formatos
// que a Claude Vision API aceita (jpeg, png, gif, webp).
//
// Fotos tiradas direto da câmera do celular (principalmente iPhone e boa
// parte dos Android recentes) vêm em HEIC/HEIF por padrão — a Claude API
// não entende esse formato. Convertemos para JPEG antes de qualquer coisa.
import convert from 'heic-convert'
import { sniff, SNIFF_BYTES } from './fileSniff'

export type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const SUPPORTED: readonly SupportedMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])

const EXT_TO_TYPE: Record<string, SupportedMediaType> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
}

function extOf(filename: string): string {
  return (filename.split('.').pop() ?? '').toLowerCase()
}

export async function normalizeImage(
  buffer: Buffer, mimeType: string, filename: string
): Promise<{ buffer: Buffer; mediaType: SupportedMediaType } | null> {
  const ext = extOf(filename)

  // ── 1. O CONTEÚDO decide ─────────────────────────────────────────────────
  // Primeiro critério de propósito. Antes a ordem era a inversa e o conteúdo
  // nem era consultado: decidia-se por `mimeType` e extensão, ambos vindos do
  // seletor de arquivos do sistema. No desktop chegam corretos; no Android
  // vêm vazios com frequência — e aí esta função devolvia null e o OCR
  // silenciosamente não rodava. Os magic bytes não variam por plataforma.
  const kind = sniff(new Uint8Array(buffer.subarray(0, SNIFF_BYTES)))
  if (kind === 'heic') {
    const jpeg = await convert({ buffer, format: 'JPEG', quality: 0.92 })
    return { buffer: Buffer.from(jpeg), mediaType: 'image/jpeg' }
  }
  if (kind === 'jpeg') return { buffer, mediaType: 'image/jpeg' }
  if (kind === 'png')  return { buffer, mediaType: 'image/png' }
  if (kind === 'gif')  return { buffer, mediaType: 'image/gif' }
  if (kind === 'webp') return { buffer, mediaType: 'image/webp' }

  // ── 2. Metadados como último recurso ─────────────────────────────────────
  // Só chega aqui conteúdo que a assinatura não reconheceu. Mantido para não
  // regredir algum formato que o Claude aceite e o sniff não cubra.
  if (SUPPORTED.includes(mimeType as SupportedMediaType)) {
    return { buffer, mediaType: mimeType as SupportedMediaType }
  }
  if (HEIC_TYPES.has(mimeType) || ext === 'heic' || ext === 'heif') {
    const jpeg = await convert({ buffer, format: 'JPEG', quality: 0.92 })
    return { buffer: Buffer.from(jpeg), mediaType: 'image/jpeg' }
  }
  if ((!mimeType || mimeType === 'application/octet-stream') && EXT_TO_TYPE[ext]) {
    return { buffer, mediaType: EXT_TO_TYPE[ext] }
  }

  return null
}
