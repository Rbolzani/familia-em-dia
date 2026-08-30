'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { destinoInternoSeguro } from '@/lib/redirectSeguro'
import { Eye, EyeOff, ArrowRight, Leaf, CalendarDays, HeartPulse, BookOpen } from 'lucide-react'

// Shared token helpers
const CARD = {
  background: 'linear-gradient(160deg,#FFFFFF 0%,#F8F3EA 100%)',
  border: '1px solid rgba(61,102,65,0.18)',
  boxShadow: '0 4px 16px rgba(44,74,46,0.10),0 1px 4px rgba(44,74,46,0.07),0 -1px 0 rgba(255,255,255,0.85) inset',
}

export default function LoginPage() {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [signupHref, setSignupHref] = useState('/auth/signup')

  // Propaga ?redirect= (ex.: link de convite) para o fluxo de criação de conta
  useEffect(() => {
    const search = window.location.search
    if (search) setSignupHref(`/auth/signup${search}`)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(`Erro: ${error.message}`); setLoading(false); return }
      if (!data.session) { setError('Sessão não criada. Tente novamente.'); setLoading(false); return }
      const params = new URLSearchParams(window.location.search)
      const dest = destinoInternoSeguro(params.get('redirect'))
      window.location.href = dest
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      setError(`Falha na conexão: ${msg}`)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#F8F3EA' }}>


      {/* ── Left hero — desktop ── */}
      <div className="hidden lg:flex flex-col justify-between w-[460px] shrink-0 p-12 relative overflow-hidden"
        style={{
          background: 'linear-gradient(165deg,#F2EAD8 0%,#E8DEC8 60%,#DDD4B8 100%)',
          borderRight: '1px solid rgba(61,102,65,0.16)',
        }}>

        {/* Organic stripe */}
        <div className="absolute top-0 left-0 w-[3px] h-full"
          style={{ background: 'linear-gradient(180deg,transparent 0%,#5A8C5E 20%,#3D6641 50%,#C49A6C 80%,transparent 100%)', opacity: 0.55 }} />

        {/* Logo */}
        <div className="relative">
          <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 40, width: 'auto', display: 'block' }} />
          <div className="text-xs italic mt-2" style={{ color: 'rgba(26,43,28,0.40)' }}>sua rotina, com leveza</div>
        </div>

        {/* Hero copy */}
        <div className="flex-1 flex flex-col justify-center relative">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] mb-5"
            style={{ color: '#5A8C5E' }}>
            Para mães e pais
          </p>
          <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 46, lineHeight: 1.18, color: '#1A2B1C', letterSpacing: '-0.02em' }}>
            Organize a vida<br/>dos seus{' '}
            <em style={{ fontStyle: 'italic', background: 'linear-gradient(120deg,#3D6641 30%,#C49A6C 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>filhos</em>
            <br/>com carinho.
          </h1>
          <p className="text-sm leading-relaxed mt-5" style={{ color: 'rgba(26,43,28,0.52)' }}>
            Escola, saúde, atividades e documentos reunidos em um app bonito e fácil.
          </p>

          {/* Preview cards */}
          <div className="mt-8 space-y-2.5">
            {[
              { icon: BookOpen,    icolor: '#2563EB', ibg: 'rgba(37,99,235,0.10)',   text: 'Prova de Matemática — Pedro', badge: 'Hoje',    bbg: 'rgba(37,99,235,0.10)',   bc: '#1D4ED8' },
              { icon: HeartPulse, icolor: '#065F46', ibg: 'rgba(6,95,70,0.10)',     text: 'Consulta pediatra — Sofia',  badge: 'Amanhã',  bbg: 'rgba(6,95,70,0.10)',    bc: '#065F46' },
              { icon: CalendarDays, icolor: '#92400E', ibg: 'rgba(146,64,14,0.10)', text: 'Natação — Lucas · 17h',      badge: 'Quinta',  bbg: 'rgba(146,64,14,0.10)', bc: '#92400E' },
            ].map((c, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-[15px] animate-fade-up"
                style={{ ...CARD, animationDelay: `${i * 0.08}s` }}>
                <span className="w-8 h-8 rounded-[9px] flex items-center justify-center flex-none"
                  style={{ background: c.ibg, boxShadow: '0 1px 3px rgba(44,74,46,0.08),0 -1px 0 rgba(255,255,255,0.60) inset' }}>
                  <c.icon size={15} color={c.icolor} strokeWidth={2} />
                </span>
                <span className="flex-1 text-sm font-semibold" style={{ color: '#1A2B1C' }}>{c.text}</span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ background: c.bbg, color: c.bc, border: '1px solid currentColor', borderColor: `${c.bc}25` }}>
                  {c.badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs relative" style={{ color: 'rgba(26,43,28,0.30)' }}>
          Powered por IA · Dados protegidos
        </p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 relative z-10">

        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center">
          <div className="flex items-center justify-center gap-3">
            <img src="/brand/icone-coral.svg" alt="" style={{ width: 56, height: 56, display: 'block' }} />
            <img src="/brand/logotipo-claro.svg" alt="Família em Dia" style={{ height: 36, width: 'auto', display: 'block' }} />
          </div>
          <div className="text-sm italic mt-3" style={{ color: 'rgba(26,43,28,0.45)' }}>sua rotina, com leveza</div>
        </div>

        <div className="w-full max-w-sm">
          <div className="rounded-[20px] p-8 animate-fade-up" style={CARD}>

            <div className="mb-7">
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] mb-3" style={{ color: '#5A8C5E' }}>
                Bem-vindo de volta
              </p>
              <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 30, color: '#1A2B1C', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                Entre na sua<br/>conta
              </h2>
              <p className="text-sm mt-2 italic" style={{ color: 'rgba(26,43,28,0.50)' }}>
                Seu dia começa aqui — organizado e tranquilo.
              </p>
            </div>

            <form onSubmit={handleSubmit} method="POST" className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-2 uppercase tracking-[0.08em]"
                  style={{ color: 'rgba(26,43,28,0.50)' }}>E-mail</label>
                <input
                  type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-2 uppercase tracking-[0.08em]"
                  style={{ color: 'rgba(26,43,28,0.50)' }}>Senha</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'} required value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-field pr-11"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 p-1 transition-opacity hover:opacity-60"
                    style={{ color: 'rgba(26,43,28,0.40)' }}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex justify-end mt-2">
                  <Link href="/auth/forgot-password" className="text-xs font-semibold transition-opacity hover:opacity-70"
                    style={{ color: '#3D6641' }}>
                    Esqueci minha senha
                  </Link>
                </div>
              </div>

              {error && (
                <div className="text-xs font-semibold px-4 py-3 rounded-[12px]"
                  style={{ background: 'linear-gradient(140deg,#FEE2E2,#FECACA)', color: '#991B1B', border: '1px solid rgba(220,38,38,0.20)' }}>
                  ⚠ {error}
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[13px] text-sm font-bold transition-all active:scale-95 disabled:opacity-60"
                style={{
                  background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)',
                  color: '#fff',
                  boxShadow: '0 6px 20px rgba(255,107,92,0.30)',
                }}
              >
                {loading
                  ? <span className="w-4 h-4 border-2 border-green-200/40 border-t-green-200 rounded-full animate-spin" />
                  : <><span>Entrar</span><ArrowRight size={15} /></>
                }
              </button>
            </form>
          </div>

          <p className="mt-5 text-center text-sm" style={{ color: 'rgba(26,43,28,0.45)' }}>
            Não tem conta?{' '}
            <Link href={signupHref} className="font-bold transition-opacity hover:opacity-70"
              style={{ color: '#3D6641' }}>
              Criar conta gratuita
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
