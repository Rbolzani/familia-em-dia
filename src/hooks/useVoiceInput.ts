'use client'
import { useState, useRef, useCallback } from 'react'

export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'error'

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void
  onError?: (message: string) => void
}

// Pick the best supported MIME type for this browser/OS
function getSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return ''
}

export function useVoiceInput({ onTranscript, onError }: UseVoiceInputOptions) {
  const [state, setState] = useState<VoiceInputState>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const streamRef   = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }, [])

  const start = useCallback(async () => {
    if (state === 'recording') { stop(); return }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = getSupportedMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current   = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        // Release mic immediately
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 1000) {
          setState('idle')
          onError?.('Áudio muito curto. Tente novamente.')
          return
        }

        setState('transcribing')
        try {
          const fd = new FormData()
          fd.append('audio', blob, 'audio.' + (recorder.mimeType?.includes('mp4') ? 'mp4' : 'webm'))
          const res = await fetch('/api/voice-transcribe', { method: 'POST', body: fd })
          const contentType = res.headers.get('content-type') ?? ''
          if (!contentType.includes('application/json')) {
            throw new Error('A transcrição de voz está indisponível no momento. Tente de novo em instantes.')
          }
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Erro ao transcrever')
          if (data.text?.trim()) {
            onTranscript(data.text.trim())
          } else {
            onError?.('Nenhuma fala detectada. Tente novamente.')
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Erro ao transcrever áudio'
          onError?.(msg)
          setState('error')
          setTimeout(() => setState('idle'), 3000)
          return
        }
        setState('idle')
      }

      recorder.start()
      setState('recording')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao acessar microfone'
      const friendly = msg.includes('Permission') || msg.includes('NotAllowed')
        ? 'Permissão de microfone negada. Habilite nas configurações do seu navegador.'
        : msg.includes('NotFound')
        ? 'Nenhum microfone encontrado neste dispositivo.'
        : 'Não foi possível acessar o microfone.'
      onError?.(friendly)
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }, [state, stop, onTranscript, onError])

  return { state, start, stop }
}
