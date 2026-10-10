// Chamada da Captura por IA a partir do navegador.
//
// POR QUE EXISTE
// Uma grade de horários densa leva minutos para ser analisada. Em 09/10/2026
// uma usuária tentou 7 vezes pelo celular: o servidor respondeu 200 em todas,
// mas só uma resposta chegou — as outras viraram "Failed to fetch" na tela,
// porque a conexão do celular cai quando fica muito tempo sem trafegar nada
// (e mais ainda se a tela apaga ou a pessoa troca de app).
//
// Três defesas, todas aqui:
//  1. A rota manda um "sinal de vida" enquanto trabalha (ver ai-extract), e
//     por isso o status real pode vir dentro do corpo, em `_status`.
//  2. A tela fica acesa durante a análise (wake lock, onde o navegador deixa).
//  3. Se ainda assim a rede cair, a mensagem explica o que fazer em vez de
//     mostrar o erro cru do navegador.

/** Acima disto a foto é reduzida antes do envio (a Vercel recusa corpo > 4,5 MB). */
const LIMITE_ENVIO_BYTES = 3.5 * 1024 * 1024
const LADO_MAXIMO = 2400
const QUALIDADE_JPEG = 0.88

export const ERRO_DE_CONEXAO =
  'A conexão caiu enquanto a IA analisava. Toque em Analisar de novo e mantenha o app aberto, com a tela acesa, até o resultado aparecer.'

/**
 * Foto grande demais para o envio vira JPEG reduzido. Fotos menores seguem
 * intactas — o que já funcionava continua igual. Se o navegador não souber
 * decodificar (HEIC do iPhone), devolve o original e o servidor converte.
 */
export async function prepararImagem(file: File): Promise<File> {
  if (file.size <= LIMITE_ENVIO_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const maior = Math.max(bitmap.width, bitmap.height)
    const escala = maior > LADO_MAXIMO ? LADO_MAXIMO / maior : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * escala)
    canvas.height = Math.round(bitmap.height * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/jpeg', QUALIDADE_JPEG))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** POST em /api/ai-extract. Devolve o status REAL (o do corpo, quando houver) e os dados. */
export async function chamarExtracaoIa(body: FormData): Promise<{ status: number; data: Record<string, unknown> }> {
  let trava: { release: () => Promise<void> } | null = null
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    trava = (await nav.wakeLock?.request('screen')) ?? null
  } catch { /* sem wake lock: segue assim mesmo */ }

  try {
    let res: Response
    let data: Record<string, unknown>
    try {
      res = await fetch('/api/ai-extract', { method: 'POST', body })
      data = await res.json()
    } catch {
      // Erro de rede (ou resposta cortada no meio): nunca chega aqui um erro
      // da nossa rota, que sempre responde JSON.
      throw new Error(ERRO_DE_CONEXAO)
    }
    const status = typeof data._status === 'number' ? data._status : res.status
    return { status, data }
  } finally {
    trava?.release().catch(() => {})
  }
}
