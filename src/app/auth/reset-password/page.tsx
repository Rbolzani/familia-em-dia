'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, ArrowRight, ArrowLeft } from 'lucide-react'

const CARD = {
  background: 'linear-gradient(160deg,#FFFFFF 0%,#F8F3EA 100%)',
  border: '1px solid rgba(61,102,65,0.18)',
  boxShadow: '0 4px 16px rgba(44,74,46,0.10),0 1px 4px rgba(44,74,46,0.07),0 -1px 0 rgba(255,255,255,0.85) inset',
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  // Token do link de recuperação (vem na query string, ex.:
  // /auth/reset-password?token_hash=...&type=recovery). NÃO verificamos aqui —
  // só no submit — para que scanners de e-mail (SafeLinks do Outlook) que apenas
  // abrem a URL (GET) não consumam o token de uso único antes do usuário.
  const [tokenHash, setTokenHash] = useState<string | null>(null)
  const [otpType, setOtpType]     = useState<EmailOtpType | null>(null)
  const [checking, setChecking]   = useState(true)
  const [validLink, setValidLink] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const th = params.get('token_hash')
    const ty = params.get('type') as EmailOtpType | null
    if (th && ty) {
      setTokenHash(th); setOtpType(ty); setValidLink(true); setChecking(false)
      return
    }
    // Sem token na URL — só é válido se já houver sessão ativa (ex.: usuário
    // logado querendo trocar a senha). Senão, link inválido/expirado.
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setValidLink(!!data.user); setChecking(false)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    setLoading(true); setError('')
    try {
      const supabase = createClient()
      // Verifica o token de recuperação AGORA (no clique), garantindo que o
      // token só é consumido por ação real do usuário — não por pré-scan.
      if (tokenHash && otpType) {
        const { error: vErr } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash })
        if (vErr) {
          setError('Este link expirou ou já foi usado. Solicite um novo.')
          setLoading(false); return
        }
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError(`Erro: ${error.message}`); setLoading(false); return }
      setDone(true)
      setTimeout(() => { window.location.href = '/dashboard' }, 1500)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      setError(`Falha na conexão: ${msg}`)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F8F3EA' }}>
      <div className="w-full max-w-sm">

        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3">
            <img src="/brand/icone-coral.svg" alt="" style={{ width: 52, height: 52, display: 'block' }} />
            <img src="/brand/logotipo-claro.svg" alt="Família em Dia" style={{ height: 34, width: 'auto', display: 'block' }} />
          </div>
        </div>

        <div className="rounded-[20px] p-8 animate-fade-up" style={CARD}>

          {checking ? (
            <div className="flex items-center justify-center py-8">
              <span className="w-6 h-6 border-2 border-green-200/40 rounded-full animate-spin"
                style={{ borderTopColor: '#3D6641' }} />
            </div>
          ) : !validLink ? (
            <div className="text-center">
              <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 24, color: '#1A2B1C', lineHeight: 1.2 }}>
                Link inválido ou expirado
              </h2>
              <p className="text-sm mt-3" style={{ color: 'rgba(26,43,28,0.55)', lineHeight: 1.55 }}>
                Este link de redefinição não é mais válido. Solicite um novo para continuar.
              </p>
              <Link href="/auth/forgot-password"
                className="inline-flex items-center justify-center gap-2 mt-5 w-full py-3.5 rounded-[13px] text-sm font-bold transition-all active:scale-95"
                style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', boxShadow: '0 6px 20px rgba(255,107,92,0.30)' }}>
                Solicitar novo link <ArrowRight size={15} />
              </Link>
            </div>
          ) : done ? (
            <div className="text-center">
              <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 26, color: '#1A2B1C', lineHeight: 1.2 }}>
                Senha atualizada!
              </h2>
              <p className="text-sm mt-3" style={{ color: 'rgba(26,43,28,0.55)', lineHeight: 1.55 }}>
                Redirecionando para o app…
              </p>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] mb-3" style={{ color: '#5A8C5E' }}>
                  Nova senha
                </p>
                <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 28, color: '#1A2B1C', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                  Defina sua<br/>nova senha
                </h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold mb-2 uppercase tracking-[0.08em]"
                    style={{ color: 'rgba(26,43,28,0.50)' }}>Nova senha</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'} required value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" className="input-field pr-11"
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 p-1 transition-opacity hover:opacity-60"
                      style={{ color: 'rgba(26,43,28,0.40)' }}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 uppercase tracking-[0.08em]"
                    style={{ color: 'rgba(26,43,28,0.50)' }}>Confirmar senha</label>
                  <input
                    type={showPw ? 'text' : 'password'} required value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••••" className="input-field"
                  />
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
                  style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', boxShadow: '0 6px 20px rgba(255,107,92,0.30)' }}
                >
                  {loading
                    ? <span className="w-4 h-4 border-2 border-green-200/40 border-t-green-200 rounded-full animate-spin" />
                    : <><span>Salvar nova senha</span><ArrowRight size={15} /></>
                  }
                </button>
              </form>
            </>
          )}
        </div>

        {!checking && validLink && !done && (
          <p className="mt-5 text-center text-sm">
            <Link href="/auth/login" className="inline-flex items-center gap-1.5 font-bold transition-opacity hover:opacity-70"
              style={{ color: '#3D6641' }}>
              <ArrowLeft size={14} /> Voltar para o login
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
