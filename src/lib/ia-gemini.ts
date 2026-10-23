// Leitura da captura por IA (/api/ai-extract) no Gemini — modelo principal
// desde 22/10/2026. O Claude continua como reserva na própria rota.
//
// POR QUE O GEMINI 3.8 FLASH
// Teste comparativo com 12 imagens reais (testes-ia/, fora do app), mesmo
// prompt e mesmas travas de lib/ia-pos-processamento.ts:
//   · 3.8 Flash (raciocínio low): 95% de acerto — grades 100%, letra de mão 100%
//   · Claude (Haiku + Sonnet nas grades): 85% — errou feio a agenda à mão
//   · 3.5 Flash-Lite: 68% — barato, mas erra dia da semana e datas
// Custo medido, no preço de 2027 (US$ 1,50 / 7,50 por milhão de tokens):
// grade ~US$ 0,07 (Sonnet: ~0,14); outras imagens ~US$ 0,011 (Claude: ~0,014).
//
// Chamada por REST, sem SDK: é um único endpoint, e evita uma dependência nova.

const MODELO_PADRAO = 'gemini-3.8-flash'

// Grade densa leva ~50 s no Gemini. Teto bem abaixo dos 300 s da rota, para
// sobrar tempo de cair no Claude (que leva ~80 s numa grade) se este travar.
const TEMPO_MAXIMO_MS = 150_000

export function geminiConfigurado(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/**
 * Manda os arquivos (imagens, PDFs) ou o texto e o prompt ao Gemini e devolve
 * o texto da resposta. Lança erro em qualquer falha — quem chama decide cair
 * no Claude.
 *
 * Usado pela captura (/api/ai-extract: uma imagem OU um texto) e pelo OCR do
 * Cofre (/api/documents/ocr: PDF, ou a mesma imagem em 3 orientações, mais um
 * texto explicando as orientações).
 */
export async function extrairComGemini(opcoes: {
  prompt: string
  imagem?: { base64: string; mediaType: string }
  imagens?: { base64: string; mediaType: string }[]
  pdfs?: string[]
  /** Textos que vão depois dos arquivos e antes do prompt. */
  textosExtras?: string[]
  texto?: string
  /** Rótulo do log de tokens (ex.: '[ocr]'). Padrão: '[ai-extract]'. */
  rotulo?: string
  tempoMaximoMs?: number
}): Promise<string> {
  const chave = process.env.GEMINI_API_KEY
  if (!chave) throw new Error('GEMINI_API_KEY ausente')
  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO

  const imagens = [...(opcoes.imagem ? [opcoes.imagem] : []), ...(opcoes.imagens ?? [])]
  const pdfs = opcoes.pdfs ?? []
  const partes: unknown[] = imagens.length || pdfs.length
    ? [
        ...pdfs.map(d => ({ inline_data: { mime_type: 'application/pdf', data: d } })),
        ...imagens.map(i => ({ inline_data: { mime_type: i.mediaType, data: i.base64 } })),
        ...(opcoes.textosExtras ?? []).map(t => ({ text: t })),
        { text: opcoes.prompt },
      ]
    : [{ text: `Conteúdo para analisar:\n\n${opcoes.texto ?? ''}\n\n${opcoes.prompt}` }]

  const inicio = Date.now()
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: partes }],
      generationConfig: {
        // Uma grade de 120 células passa de 8 mil tokens de saída.
        maxOutputTokens: 32_000,
        responseMimeType: 'application/json',
        // "low": no teste, "minimal" errava a conta de datas de calendário
        // com frequência; "low" acertou e custa quase o mesmo.
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
    signal: AbortSignal.timeout(opcoes.tempoMaximoMs ?? TEMPO_MAXIMO_MS),
  })
  const corpo = await res.json().catch(() => null) as {
    error?: { message?: string }
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  } | null
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${corpo?.error?.message ?? 'sem detalhe'}`)

  const candidato = corpo?.candidates?.[0]
  const texto = (candidato?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('').trim()
  const u = corpo?.usageMetadata ?? {}
  // Tokens no log: é o que permite conferir o custo real por captura.
  console.info(`${opcoes.rotulo ?? '[ai-extract]'} gemini`, {
    modelo, segundos: Math.round((Date.now() - inicio) / 1000),
    entrada: u.promptTokenCount ?? 0, saida: u.candidatesTokenCount ?? 0, raciocinio: u.thoughtsTokenCount ?? 0,
    fim: candidato?.finishReason ?? '?',
  })
  if (!texto) throw new Error(`Gemini sem texto (fim: ${candidato?.finishReason ?? '?'})`)
  return texto
}
