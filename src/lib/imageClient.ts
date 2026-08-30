// Rotação de imagem NO NAVEGADOR, para o OCR ler documento deitado.
//
// POR QUE NÃO NO SERVIDOR
// A primeira tentativa girava com `sharp`. Ela quebrou duas vezes em
// produção: primeiro derrubando a rota inteira (binário nativo empacotado
// pelo bundler → 500 no carregamento do módulo), depois falhando dentro do
// try e caindo em silêncio para uma orientação só — indistinguível, da tela,
// de não ter rotação nenhuma.
//
// O navegador decodifica e gira imagem sem dependência nativa, sem passo de
// build e sem serverless no meio. É o mesmo motor que já desenhou a foto na
// tela quando o usuário a escolheu.
//
// EFEITO COLATERAL BOM: as três orientações saem como JPEG redimensionado.
// Um print de celular em PNG costuma pesar mais do que as três versões
// somadas — o envio tende a ficar MENOR, não maior, apesar de levar o triplo
// de imagens.

/** Maior lado da imagem enviada. Acima disso o OCR não melhora e o upload piora. */
const LADO_MAXIMO = 1600
const QUALIDADE_JPEG = 0.85

/** Graus enviados: cobre cartão deitado para os dois lados. */
export const ORIENTACOES = [0, 90, 270] as const

async function girar(bitmap: ImageBitmap, graus: number): Promise<Blob> {
  const trocaEixos = graus === 90 || graus === 270
  const lo = Math.max(bitmap.width, bitmap.height)
  const escala = lo > LADO_MAXIMO ? LADO_MAXIMO / lo : 1
  const l = Math.round(bitmap.width * escala)
  const a = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = trocaEixos ? a : l
  canvas.height = trocaEixos ? l : a
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas indisponível')

  // Gira em torno do centro do canvas de destino; a origem do desenho volta
  // para o canto da imagem já rotacionada.
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((graus * Math.PI) / 180)
  ctx.drawImage(bitmap, -l / 2, -a / 2, l, a)

  return new Promise<Blob>((ok, erro) => {
    canvas.toBlob(b => b ? ok(b) : erro(new Error('toBlob vazio')), 'image/jpeg', QUALIDADE_JPEG)
  })
}

/**
 * Devolve o MESMO documento em 0°, 90° e 270°.
 *
 * Se o navegador não conseguir decodificar (HEIC do iPhone é o caso comum, e
 * quem converte é o servidor), devolve `null` — quem chama envia o arquivo
 * original e o OCR segue com uma orientação só.
 */
export async function gerarOrientacoes(file: File): Promise<File[] | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const saida: File[] = []
    for (const g of ORIENTACOES) {
      const blob = await girar(bitmap, g)
      saida.push(new File([blob], `orientacao-${g}.jpg`, { type: 'image/jpeg' }))
    }
    bitmap.close()
    return saida
  } catch (e) {
    console.warn('[ocr] nao foi possivel gerar orientacoes no navegador:', e)
    return null
  }
}
