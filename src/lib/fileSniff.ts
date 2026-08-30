// Identificação de arquivo pelo CONTEÚDO, não pelo que o navegador diz.
//
// POR QUE ISTO EXISTE
// O OCR do cofre funcionava no desktop e não funcionava no celular, com o
// MESMO arquivo. A causa não era a lógica de classificação: era que todo o
// caminho — filtro do cliente, escolha do ramo PDF/imagem no servidor,
// normalização — decidia a partir de `file.type` e da extensão do nome.
//
// Esses dois campos vêm do seletor de arquivos do sistema. No desktop chegam
// preenchidos ("application/pdf", "CNH.pdf"). No Android variam por
// fabricante e por app de arquivos: `file.type` vem vazio ou
// "application/octet-stream", e alguns provedores entregam o nome sem
// extensão. Com os dois vazios, o arquivo era descartado antes mesmo de
// alguém olhar o conteúdo.
//
// Os magic bytes são os mesmos em qualquer plataforma. Esta função é a única
// fonte de verdade sobre "que arquivo é este", e roda igual nos dois lados.

export type SniffedKind = 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | null

/** Bytes suficientes para todas as assinaturas abaixo. */
export const SNIFF_BYTES = 16

/**
 * Identifica o formato pelos primeiros bytes. `null` = não reconhecido.
 * Recebe Uint8Array para servir tanto ao browser quanto ao Node.
 */
export function sniff(b: Uint8Array): SniffedKind {
  const em = (...bytes: number[]) => bytes.every((x, i) => b[i] === x)

  if (em(0x25, 0x50, 0x44, 0x46)) return 'pdf'                       // %PDF
  if (em(0xFF, 0xD8, 0xFF)) return 'jpeg'
  if (em(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return 'png'
  if (em(0x47, 0x49, 0x46, 0x38)) return 'gif'                       // GIF8
  // RIFF....WEBP — os 4 bytes do meio são o tamanho e variam.
  if (em(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'webp'
  }
  // ISO-BMFF: 4 bytes de tamanho, 'ftyp', e a marca do formato.
  // Fotos de iPhone e de boa parte dos Android recentes caem aqui.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const marca = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(marca)) {
      return 'heic'
    }
  }
  return null
}

/** O OCR consegue ler este conteúdo? */
export function podeSerLido(kind: SniffedKind): boolean {
  return kind !== null
}

/** Lê o cabeçalho de um File do navegador. Funciona igual em qualquer sistema. */
export async function sniffFile(file: File): Promise<SniffedKind> {
  try {
    const buf = await file.slice(0, SNIFF_BYTES).arrayBuffer()
    return sniff(new Uint8Array(buf))
  } catch {
    return null
  }
}
