'use client'
import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MessageCircle, Send, Lock } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { QRCodeSVG } from 'qrcode.react'
import { useUpsell } from '@/components/billing/Upsell'

interface Props {
  userId: string
  userEmail: string
  whatsapp: { number: string; enabled: boolean; time: string }
  prefilledFromCadastro?: boolean
  twilioMode?: boolean
  twilioKeyword?: string
  whatsappBlocked?: boolean
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

export default function AlertasClient({ userId, userEmail, whatsapp, prefilledFromCadastro, twilioMode, twilioKeyword, whatsappBlocked }: Props) {
  const supabase = createClient()
  const { abrir: abrirUpsell } = useUpsell()

  const [waNumber, setWaNumber]   = useState(whatsapp.number)
  const [waEnabled, setWaEnabled] = useState(whatsapp.enabled)
  const [waTime, setWaTime]       = useState(whatsapp.time)
  const [waSaving, setWaSaving]   = useState(false)
  const [waTesting, setWaTesting] = useState(false)

  function normalizePhone(raw: string): string {
    return raw.replace(/\D/g, '')
  }

  async function saveWhatsApp(enabledOverride?: boolean, timeOverride?: string) {
    const digits = normalizePhone(waNumber)
    const enabled = enabledOverride ?? waEnabled
    if (enabled && (digits.length < 12 || digits.length > 14)) {
      toast('Número inválido. Use DDI+DDD+número, ex.: 5511999998888', 'error')
      return false
    }
    setWaSaving(true)
    const { error } = await supabase
      .from('notification_settings')
      .upsert({
        user_id: userId,
        whatsapp_number: digits || null,
        daily_summary_enabled: enabled,
        summary_time: timeOverride ?? waTime,
        updated_at: new Date().toISOString(),
      })
    setWaSaving(false)
    if (error) { toast('Não foi possível salvar. Tente novamente.', 'error'); return false }
    toast('Preferências salvas ✓')
    return true
  }

  async function toggleWa() {
    const next = !waEnabled
    if (next) {
      const digits = normalizePhone(waNumber)
      if (digits.length < 12 || digits.length > 14) {
        toast('Informe seu número antes de ativar. Ex.: 5511999998888', 'error')
        return
      }
    }
    setWaEnabled(next)
    await saveWhatsApp(next)
  }

  async function sendTest() {
    const saved = await saveWhatsApp()
    if (!saved) return
    setWaTesting(true)
    try {
      const res = await fetch('/api/whatsapp-test', { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        toast('Mensagem de teste enviada! Confira seu WhatsApp 📱')
      } else {
        toast(json.error ?? 'Falha no envio do teste.', 'error')
      }
    } catch {
      toast('Falha de conexão ao enviar o teste.', 'error')
    }
    setWaTesting(false)
  }

  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(160deg,#FFFFFF 0%,#F8F3EA 100%)',
    border: '1px solid rgba(61,102,65,0.18)',
    boxShadow: '0 4px 16px rgba(44,74,46,0.08),0 1px 4px rgba(44,74,46,0.05)',
    borderRadius: 16,
    padding: '20px 20px',
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-5 space-y-5">
      {/* Header */}
      <div className="animate-fade-up">
        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#2D6A35' }}>
          🔔 Notificações
        </p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 24, fontWeight: 700, color: '#1A2B1C' }}>
          Alertas
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.45)', marginTop: 2 }}>
          {userEmail}
        </p>
      </div>

      {/* Banner modo teste Twilio */}
      {twilioMode && (() => {
        const waUrl = `https://wa.me/14155238886?text=join%20${encodeURIComponent(twilioKeyword ?? '')}`
        return (
          <div className="animate-fade-up rounded-2xl p-4" style={{
            background: 'linear-gradient(135deg, #FFF8E7 0%, #FFF3D0 100%)',
            border: '1.5px solid rgba(196,130,0,0.25)',
            boxShadow: '0 2px 12px rgba(196,130,0,0.08)',
          }}>
            <div className="flex items-start gap-3 mb-3">
              <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: '#7A5000' }}>
                Modo de teste ativo — passo obrigatório antes de receber mensagens
              </p>
            </div>

            <div className="flex gap-4 items-start">
              {/* QR Code */}
              <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div className="rounded-xl overflow-hidden p-2" style={{ background: '#fff', border: '1.5px solid rgba(196,130,0,0.20)' }}>
                  <QRCodeSVG
                    value={waUrl}
                    size={110}
                    bgColor="#ffffff"
                    fgColor="#7A5000"
                    level="M"
                  />
                </div>
                <span style={{ fontSize: 10.5, color: 'rgba(122,80,0,0.65)', fontWeight: 600, textAlign: 'center' }}>
                  Escaneie com o celular
                </span>
              </div>

              {/* Instruções */}
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 13, color: '#7A5000', lineHeight: 1.6, marginBottom: 10 }}>
                  Escaneie o QR Code ou envie manualmente a mensagem abaixo pelo WhatsApp:
                </p>
                <div className="flex flex-col gap-2 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(122,80,0,0.55)', minWidth: 52 }}>Número</span>
                    <code style={{ background: 'rgba(196,130,0,0.12)', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700, color: '#7A5000' }}>
                      +1 415 523 8886
                    </code>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(122,80,0,0.55)', minWidth: 52 }}>Mensagem</span>
                    <code style={{ background: 'rgba(196,130,0,0.12)', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700, color: '#7A5000' }}>
                      join {twilioKeyword}
                    </code>
                  </div>
                </div>
                <p style={{ fontSize: 11.5, color: 'rgba(122,80,0,0.60)', lineHeight: 1.5 }}>
                  Após receber a confirmação no WhatsApp, configure seu número abaixo e clique em testar.
                </p>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Resumo matinal no WhatsApp */}
      {whatsappBlocked ? (
        <div style={{ ...cardStyle, background: 'linear-gradient(160deg,#FAFAF7,#F3F4F6)' }} className="animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(107,114,128,0.10)' }}>
              <MessageCircle size={14} color="rgba(107,114,128,0.50)" />
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'rgba(26,43,28,0.40)' }}>Resumo matinal no WhatsApp</h2>
          </div>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(107,114,128,0.10)' }}>
              <Lock size={20} color="rgba(107,114,128,0.50)" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(26,43,28,0.50)' }}>
              Disponível no plano Família
            </p>
            <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.40)', maxWidth: 280, lineHeight: 1.5 }}>
              Receba o resumo diário das atividades dos seus filhos direto no WhatsApp — provas, consultas, quem leva e quem busca.
            </p>
            <button type="button" onClick={() => abrirUpsell('whatsapp')}
              className="mt-1 px-5 py-2.5 rounded-xl font-bold text-white text-sm transition-all hover:brightness-105 active:scale-95"
              style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', border: 'none', cursor: 'pointer' }}>
              Conhecer o Família
            </button>
          </div>
        </div>
      ) : (
      <div style={cardStyle} className="animate-fade-up">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(61,102,65,0.10)' }}>
            <MessageCircle size={14} color="#2D6A35" />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1A2B1C' }}>Resumo matinal no WhatsApp</h2>
        </div>

        <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.55)', lineHeight: 1.5, marginBottom: 16 }}>
          Todo dia no horário escolhido, receba no WhatsApp o resumo
          das atividades do dia e da semana — provas, consultas, quem leva e quem busca.
        </p>

        {/* Número */}
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(26,43,28,0.50)', marginBottom: 6 }}>
          Seu WhatsApp (DDI + DDD + número)
        </label>
        <div className="flex gap-2 mb-4">
          <input
            type="tel"
            inputMode="numeric"
            value={waNumber}
            onChange={e => setWaNumber(e.target.value)}
            placeholder="5511999998888"
            className="input-field"
            style={{ flex: 1 }}
          />
          <button
            onClick={() => saveWhatsApp()}
            disabled={waSaving}
            className="px-4 rounded-[13px] font-bold text-white transition-all hover:brightness-105 active:scale-95 disabled:opacity-60 flex-shrink-0"
            style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', fontSize: 13 }}>
            {waSaving ? '...' : 'Salvar'}
          </button>
        </div>
        {prefilledFromCadastro && (
          <p style={{ fontSize: 12, color: 'rgba(26,43,28,0.50)', margin: '-8px 0 16px' }}>
            Preenchemos com o celular do seu cadastro. Se o seu WhatsApp for outro número, altere e salve.
          </p>
        )}

        {/* Toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl mb-3"
          style={{ background: waEnabled ? 'rgba(61,102,65,0.07)' : 'rgba(26,43,28,0.03)', border: `1px solid ${waEnabled ? 'rgba(61,102,65,0.22)' : 'rgba(26,43,28,0.08)'}` }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A2B1C' }}>Resumo diário ativo</div>
            <div style={{ fontSize: 11.5, color: 'rgba(26,43,28,0.45)' }}>
              {waEnabled ? `Você receberá a mensagem todo dia às ${waTime}` : 'Ative para começar a receber'}
            </div>
          </div>
          <button onClick={toggleWa}
            aria-label="Ativar/desativar resumo diário"
            style={{ position: 'relative', width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: waEnabled ? 'linear-gradient(135deg,#3D6641,#2C4A2E)' : 'rgba(61,102,65,0.22)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)', transition: 'background .25s' }}>
            <span style={{ position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%', background: 'white',
              boxShadow: '0 2px 5px rgba(0,0,0,0.25)', left: waEnabled ? 25 : 3, transition: 'left .3s cubic-bezier(.4,0,.2,1)' }} />
          </button>
        </div>

        {/* Horário de envio */}
        <div className="flex items-center justify-between p-3 rounded-xl mb-4"
          style={{ background: 'rgba(26,43,28,0.03)', border: '1px solid rgba(26,43,28,0.08)' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A2B1C' }}>Horário do envio</div>
            <div style={{ fontSize: 11.5, color: 'rgba(26,43,28,0.45)' }}>
              Fuso de Brasília · horários de 15 em 15 minutos
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <select
              value={waTime.slice(0, 2)}
              onChange={e => {
                const next = `${e.target.value}:${waTime.slice(3, 5)}`
                setWaTime(next)
                saveWhatsApp(undefined, next)
              }}
              className="input-field"
              style={{ width: 62, textAlign: 'center', fontWeight: 700, paddingLeft: 4, paddingRight: 4 }}
            >
              {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span style={{ fontWeight: 700, color: 'rgba(26,43,28,0.45)' }}>:</span>
            <select
              value={waTime.slice(3, 5)}
              onChange={e => {
                const next = `${waTime.slice(0, 2)}:${e.target.value}`
                setWaTime(next)
                saveWhatsApp(undefined, next)
              }}
              className="input-field"
              style={{ width: 62, textAlign: 'center', fontWeight: 700, paddingLeft: 4, paddingRight: 4 }}
            >
              {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Teste */}
        <button
          onClick={sendTest}
          disabled={waTesting}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold transition-all hover:bg-black/[0.04] active:scale-95 disabled:opacity-60"
          style={{ color: '#3D6641', border: '1.5px solid rgba(61,102,65,0.30)', background: 'none', fontSize: 13.5 }}>
          <Send size={14} />
          {waTesting ? 'Enviando teste...' : 'Enviar resumo de teste agora'}
        </button>
      </div>
      )}
    </div>
  )
}
