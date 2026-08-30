import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, consumirChamadaIa, mensagemLimiteDiario } from '@/lib/billing'

// Mesma razão do OCR: o áudio sobe do celular e o tempo de subida conta para
// a duração da função. Um áudio de um minuto em 4G passa dos 10s padrão.
export const maxDuration = 60

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const ALLOWED_AUDIO_TYPES = [
  'audio/webm', 'audio/webm;codecs=opus',
  'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg',
]

export async function POST(request: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY não configurada no servidor.' },
      { status: 500 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const plan = await getFamilyPlan()
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'LIMIT_VOICE', message: 'Entrada por voz disponível nos planos Família e Plus.' },
      { status: 402 }
    )
  }

  // Teto diário (achado O3). Esta rota não tinha limite NENHUM de volume —
  // só o gate de plano — e cada transcrição custa por minuto na Groq.
  const cota = await consumirChamadaIa(user.id)
  if (!cota.permitido) {
    return NextResponse.json({ error: mensagemLimiteDiario(cota) }, { status: 429 })
  }

  const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }

  const audio = formData.get('audio')
  if (!audio || !(audio instanceof File)) {
    return NextResponse.json({ error: 'Arquivo de áudio obrigatório' }, { status: 400 })
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Áudio muito grande (máx 25 MB)' }, { status: 400 })
  }

  const mimeBase = audio.type.split(';')[0]
  if (!ALLOWED_AUDIO_TYPES.some(t => t.startsWith(mimeBase))) {
    return NextResponse.json({ error: `Formato de áudio não suportado: ${audio.type}` }, { status: 400 })
  }

  // Whisper needs a proper file extension to detect the codec
  const ext = audio.type.includes('mp4') ? 'mp4'
    : audio.type.includes('wav') ? 'wav'
    : audio.type.includes('mpeg') ? 'mp3'
    : audio.type.includes('ogg') ? 'ogg'
    : 'webm'

  const file = new File([audio], `audio.${ext}`, { type: audio.type })

  try {
    const transcription = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'pt',
    })

    return NextResponse.json({ text: transcription.text })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao transcrever áudio'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
