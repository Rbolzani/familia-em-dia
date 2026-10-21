'use client'
import { useState, useEffect } from 'react'
import { Mail, Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { PlanId } from '@/lib/planos-limites'

const APP_VERSION = '1.0.0'

const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Gratuito', basico: 'Básico', familia: 'Família', plus: 'Família Plus', pausada: 'Conta pausada',
}

type Channel = 'email' | 'whatsapp'

interface PlanCfg {
  channel: Channel
  label: string
  sla: string | null
  priority: boolean
}

const CFG: Record<PlanId, PlanCfg> = {
  free:    { channel:'email',    label:'Fale com o suporte',  sla: null,                  priority: false },
  pausada: { channel:'email',    label:'Fale com o suporte',  sla: null,                  priority: false },
  basico:  { channel:'email',    label:'Fale com o suporte',  sla: 'Resposta em até 72h', priority: false },
  familia: { channel:'email',    label:'Fale com o suporte',  sla: 'Resposta em até 72h', priority: false },
  plus:    { channel:'whatsapp', label:'Suporte prioritário', sla: 'Resposta em até 12h', priority: true  },
}

export default function SupportButton() {
  const [plan,     setPlan]     = useState<PlanId>('free')
  const [userName, setUserName] = useState('')
  const [userEmail,setUserEmail]= useState('')
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserName(user.user_metadata?.full_name ?? user.email ?? 'Usuário')
      setUserEmail(user.email ?? '')
      const { data } = await supabase.rpc('get_family_plan')
      const p = (data as PlanId) ?? 'free'
      setPlan(p in CFG ? p : 'free')
      setReady(true)
    }
    load()
  }, [])

  function handleClick() {
    const cfg = CFG[plan]

    if (cfg.channel === 'whatsapp') {
      const number = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? ''
      if (!number) return
      const msg = encodeURIComponent(
        `Olá! Preciso de ajuda com o Família em Dia.\n` +
        `Usuário: ${userName}\n` +
        `Plano: ${PLAN_LABELS[plan]}\n` +
        `Versão: ${APP_VERSION}`
      )
      window.open(`https://wa.me/${number}?text=${msg}`, '_blank')
    } else {
      const email   = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'suporte@familiaemdia.com.br'
      const subject = encodeURIComponent(`[Suporte] ${PLAN_LABELS[plan]} — ${userName}`)
      const body    = encodeURIComponent(
        `Olá equipe Família em Dia,\n\n` +
        `Preciso de ajuda com o seguinte:\n\n[descreva aqui sua dúvida ou problema]\n\n` +
        `---\n` +
        `Usuário: ${userName}\n` +
        `E-mail: ${userEmail}\n` +
        `Plano: ${PLAN_LABELS[plan]}\n` +
        `Versão: ${APP_VERSION}`
      )
      window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_self')
    }
  }

  const cfg = CFG[plan]
  // E-mail sempre disponível (fallback fixo suporte@familiaemdia.com.br).
  // WhatsApp depende da env var (número dedicado ainda a configurar).
  const hasConfig = cfg.channel === 'whatsapp'
    ? !!process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP
    : true

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
      <button
        onClick={handleClick}
        disabled={!ready || !hasConfig}
        style={{
          display:'flex', alignItems:'center', gap:10,
          padding:'14px 28px', borderRadius:14, border:'none',
          cursor: ready && hasConfig ? 'pointer' : 'default',
          background: cfg.priority
            ? 'linear-gradient(135deg,#E2553F,#C4452A)'
            : 'linear-gradient(135deg,#FF8A6E,#FF6B5C)',
          boxShadow:'0 4px 18px rgba(255,107,92,0.28)',
          opacity: !ready ? 0.6 : 1,
          transition:'opacity 0.2s',
        }}>
        {cfg.priority ? <Zap size={18} color="#D4E8D5" /> : <Mail size={18} color="#D4E8D5" />}
        <span style={{ fontSize:15, fontWeight:700, color:'#D4E8D5' }}>
          {cfg.label}{cfg.priority ? ' ⚡' : ''}
        </span>
      </button>

      {cfg.sla && (
        <span style={{ fontSize:12.5, color:'rgba(26,43,28,0.50)', fontStyle:'italic' }}>
          {cfg.sla}
        </span>
      )}

      {/* Indicador de canal */}
      <span style={{ fontSize:11.5, color:'rgba(26,43,28,0.35)' }}>
        {cfg.channel === 'whatsapp' ? 'via WhatsApp' : 'via e-mail'}
      </span>

      {!hasConfig && (
        <span style={{ fontSize:11.5, color:'rgba(26,43,28,0.35)', fontStyle:'italic' }}>
          Suporte em breve
        </span>
      )}
    </div>
  )
}
