'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { captureAttribution } from '@/lib/attribution'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  // Captura UTM/referrer no primeiro acesso ao signup (atribuição de aquisição).
  useEffect(() => { captureAttribution() }, [])
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return }
    setLoading(true); setError('')

    const params = new URLSearchParams(window.location.search)
    const redirect = params.get('redirect')
    const isInvite = redirect?.startsWith('/convite/')

    if (isInvite) {
      // Fluxo de convite: cria usuário já confirmado via admin API e loga em seguida.
      // O token vai junto: o endpoint só confirma o e-mail automaticamente se
      // houver um convite pendente com ele. Sem isso a rota seria um criador
      // público de contas já confirmadas.
      const inviteToken = redirect!.replace('/convite/', '')
      const res = await fetch('/api/auth/signup-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, familyName: familyName.trim() || 'Minha Família', token: inviteToken }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Erro ao criar conta.'); setLoading(false); return }

      // Usuário criado e confirmado — faz login para obter sessão
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) { setError(signInError.message); setLoading(false); return }

      // Auto-aceita o convite sem mostrar a tela de convite novamente.
      // Extrai o token do redirect (/convite/TOKEN).
      const token = redirect!.replace('/convite/', '')

      // Busca o family_id do convite para poder trocar a família ativa
      const { data: rows } = await supabase.rpc('get_invite_details', { p_token: token })
      const invite = rows?.[0] as { family_id: string } | undefined

      // Aceita o convite (RPC SECURITY DEFINER)
      await supabase.rpc('accept_invite', { p_token: token })

      // Troca a família ativa para a família do dono do convite
      if (invite?.family_id) {
        await supabase.rpc('switch_active_family', { p_family_id: invite.family_id })
      }

      // Limpa o cookie pending_invite (não é mais necessário)
      document.cookie = 'pending_invite=; path=/; max-age=0'

      // Vai direto para completar o cadastro (ou dashboard se já completou)
      router.push('/completar-cadastro')
      return
    }

    // Fluxo normal: cadastro com confirmação de e-mail obrigatória.
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { full_name: name, family_name: familyName.trim() || 'Minha Família' },
        emailRedirectTo: `${window.location.origin}/auth/callback${window.location.search}`,
      },
    })
    if (error) { setError(error.message); setLoading(false); return }
    if (data.session) {
      const dest = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard'
      router.push(dest)
    } else {
      setSuccess(true)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F8F3EA' }}>
        <div className="text-center animate-scale-in max-w-sm">
          <div className="text-6xl mb-5 animate-float">📬</div>
          <h2 className="text-3xl font-bold mb-3" style={{ fontFamily: 'var(--font-lora)', color: '#1A2B1C' }}>
            Confirme seu e-mail
          </h2>
          <p className="text-sm leading-relaxed mb-6" style={{ color: 'rgba(26,43,28,0.60)' }}>
            Enviamos um link de confirmação para <strong style={{ color: '#1A2B1C' }}>{email}</strong>.
            <br /><br />
            Abra o e-mail e clique no link para ativar sua conta. Depois, volte aqui e faça login.
          </p>
          <a href={`/auth/login${typeof window !== 'undefined' ? window.location.search : ''}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', boxShadow: '0 4px 16px rgba(44,74,46,0.30)' }}>
            Ir para o login →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#F7F5FF' }}>

      {/* Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full" style={{ width: 450, height: 450, background: 'rgba(196,195,255,0.45)', filter: 'blur(70px)', top: -100, right: -80 }} />
        <div className="absolute rounded-full" style={{ width: 300, height: 300, background: 'rgba(168,221,181,0.35)', filter: 'blur(60px)', bottom: '15%', left: -60 }} />
      </div>

      {/* ── Painel esquerdo (desktop) ── */}
      <div className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #EEF0FF 0%, #F0EBFF 50%, #F0FFF8 100%)' }}>

        <div className="relative">
          <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 40, width: 'auto', display: 'block' }} />
          <div className="text-xs mt-2" style={{ color: '#8585A8' }}>Organize · Cuide · Celebre</div>
        </div>

        <div className="relative flex-1 flex flex-col justify-center">
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#7B6FE8' }}>
            Comece hoje, é grátis
          </p>
          <h1 style={{ fontFamily: 'var(--font-gilda)', fontSize: 44, lineHeight: 1.2, color: '#1A1535' }}>
            Sua família<br/>merece o melhor<br/>da organização. 💚
          </h1>
          <p className="text-sm leading-relaxed mt-5" style={{ color: '#8585A8' }}>
            Crie sua conta em segundos e comece a organizar a rotina com inteligência artificial.
          </p>

          <div className="mt-8 space-y-3">
            {['Crie sua conta gratuita', 'Cadastre seus filhos', 'Adicione atividades com IA'].map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-none"
                  style={{ background: 'rgba(123,111,232,0.15)', color: '#7B6FE8' }}>
                  {i + 1}
                </span>
                <span className="text-sm" style={{ color: '#8585A8' }}>{s}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs" style={{ color: '#C0BFD5' }}>✓ Sem cartão de crédito · ✓ Cancele quando quiser</p>
      </div>

      {/* ── Painel direito — form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 relative z-10">

        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center">
          <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 44, width: 'auto', display: 'block', margin: '0 auto' }} />
        </div>

        <div className="w-full max-w-sm">
          <div className="bg-white rounded-3xl p-8 animate-fade-up"
            style={{ boxShadow: '0 24px 80px rgba(123,111,232,0.12), 0 0 0 1px rgba(123,111,232,0.08)' }}>

            <div className="mb-7">
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7B6FE8' }}>
                Crie sua conta 🚀
              </p>
              <h2 style={{ fontFamily: 'var(--font-gilda)', fontSize: 30, color: '#1A1535', lineHeight: 1.2 }}>
                Grátis para sempre
              </h2>
              <p className="text-sm mt-2" style={{ color: '#8585A8' }}>Sem cartão de crédito.</p>
            </div>

            <form onSubmit={handleSubmit} method="POST" className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#8585A8' }}>Seu nome</label>
                <input type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="João Silva" className="input-field" />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: '#8585A8' }}>Nome da família</label>
                <p className="text-xs mb-2" style={{ color: '#C0BFD5' }}>Como seus filhos e parceiros verão sua conta</p>
                <input type="text" required value={familyName} onChange={e => setFamilyName(e.target.value)}
                  placeholder="Ex.: Família Silva" className="input-field" />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#8585A8' }}>E-mail</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com" className="input-field" />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#8585A8' }}>Senha</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} required value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres" className="input-field pr-11" />
                  <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 p-1 transition-opacity hover:opacity-60"
                    style={{ color: '#8585A8' }}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {[1,2,3,4].map(n => (
                      <div key={n} className="flex-1 h-1 rounded-full transition-all"
                        style={{ background: password.length >= n * 2 ? (password.length >= 8 ? '#A8DDB5' : '#FFE4A0') : '#E8E4FF' }} />
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="text-xs font-semibold px-4 py-3 rounded-2xl"
                  style={{ background: '#FFF0F4', color: '#C0405A', border: '1px solid rgba(240,100,130,0.2)' }}>
                  ⚠ {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#7B6FE8,#C084FC)', boxShadow: '0 8px 28px rgba(123,111,232,0.30)' }}>
                {loading
                  ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <><span>Criar conta grátis</span><ArrowRight size={15} /></>
                }
              </button>
            </form>
          </div>

          <p className="mt-5 text-center text-sm" style={{ color: '#8585A8' }}>
            Já tem conta?{' '}
            <Link href="/auth/login" className="font-bold transition-opacity hover:opacity-70" style={{ color: '#7B6FE8' }}>
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
