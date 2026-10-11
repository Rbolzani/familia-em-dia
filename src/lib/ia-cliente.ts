// Chamada da Captura por IA a partir do navegador.
//
// POR QUE EXISTE
// Uma grade de horários densa leva mais de um minuto para ser analisada. Em
// 09 e 10/10/2026 a captura falhou no celular ("Failed to fetch") embora o
// servidor estivesse saudável: a mesma foto, enviada de um computador para a
// produção, voltou em 89s. A falha é do lado do aparelho, e há duas causas
// conhecidas para esse erro no Chrome do Android:
//   a) a conexão cai durante a espera longa (rede ociosa, tela apagada);
//   b) o arquivo escolhido deixa de poder ser lido na hora do envio (foto que
//      vem da galeria/nuvem por um endereço temporário) — o envio morre na
//      hora, e repetir com o mesmo arquivo falha de novo.
//
// Defesas, todas aqui:
//  1. `lerParaMemoria` copia a foto para a memória no momento da escolha, e o
//     envio não depende mais do endereço temporário (causa b).
//  2. A rota manda um "sinal de vida" enquanto trabalha (ver ai-extract); por
//     isso o status real pode vir dentro do corpo, em `_status` (causa a).
//  3. A tela fica acesa durante a análise (wake lock, onde o navegador deixa).
//  4. Se ainda assim falhar, a mensagem orienta em vez de mostrar o erro cru,
//     e o navegador relata o que viu para /api/ai-extract/diag.

/** Acima disto a foto é reduzida antes do envio (a Vercel recusa corpo > 4,5 MB). */
const LIMITE_ENVIO_BYTES = 3.5 * 1024 * 1024
const LADO_MAXIMO = 2400
const QUALIDADE_JPEG = 0.88

export const ERRO_DE_CONEXAO =
  'A conexão caiu enquanto a IA analisava. Toque em Analisar de novo e mantenha o app aberto, com a tela acesa, até o resultado aparecer.'
export const ERRO_DE_ENVIO =
  'Não consegui enviar a foto. Remova a foto, escolha de novo (ou tire outra) e toque em Analisar.'

/**
 * Copia o arquivo escolhido para a memória. Devolve `null` se o navegador não
 * conseguir ler — melhor avisar na escolha do que falhar no envio.
 */
export async function lerParaMemoria(file: File): Promise<File | null> {
  try {
    const bytes = await file.arrayBuffer()
    if (bytes.byteLength === 0) return null
    return new File([bytes], file.name || 'foto.jpg', { type: file.type, lastModified: file.lastModified })
  } catch {
    return null
  }
}

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

function relatar(dados: Record<string, unknown>) {
  try {
    const con = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }).connection
    const corpo = JSON.stringify({
      ...dados, online: navigator.onLine, visivel: document.visibilityState,
      rede: [con?.type, con?.effectiveType].filter(Boolean).join('/'),
    })
    fetch('/api/ai-extract/diag', { method: 'POST', body: corpo, keepalive: true }).catch(() => {})
  } catch { /* diagnóstico nunca atrapalha a tela */ }
}

/** POST em /api/ai-extract. Devolve o status REAL (o do corpo, quando houver) e os dados. */
export async function chamarExtracaoIa(body: FormData): Promise<{ status: number; data: Record<string, unknown> }> {
  let trava: { release: () => Promise<void> } | null = null
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    trava = (await nav.wakeLock?.request('screen')) ?? null
  } catch { /* sem wake lock: segue assim mesmo */ }

  const foto = body.get('image')
  const sobreFoto = foto instanceof File ? { fotoBytes: foto.size, fotoTipo: foto.type } : {}
  const t0 = Date.now()
  try {
    let res: Response
    try {
      res = await fetch('/api/ai-extract', { method: 'POST', body })
    } catch (e) {
      // Nem os cabeçalhos chegaram. Rápido = o envio não saiu (arquivo
      // ilegível, sem rede); demorado = a conexão caiu na espera.
      const ms = Date.now() - t0
      relatar({ fase: 'envio', ms, erro: (e as Error)?.message, ...sobreFoto })
      throw new Error(ms < 8000 && foto instanceof File ? ERRO_DE_ENVIO : ERRO_DE_CONEXAO)
    }
    let texto = ''
    try {
      texto = await res.text()
      const data = JSON.parse(texto) as Record<string, unknown>
      const status = typeof data._status === 'number' ? data._status : res.status
      return { status, data }
    } catch (e) {
      // Resposta cortada no meio (ou que não é o JSON da nossa rota).
      relatar({ fase: 'resposta', ms: Date.now() - t0, erro: (e as Error)?.message, http: res.status, bytesRecebidos: texto.length, ...sobreFoto })
      throw new Error(ERRO_DE_CONEXAO)
    }
  } finally {
    trava?.release().catch(() => {})
  }
}
