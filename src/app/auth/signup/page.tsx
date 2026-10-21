'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { captureAttribution, readAttribution, clearAttribution } from '@/lib/attribution'
import { formatCPF, formatPhoneBR, isValidCPF, isValidPhoneBR } from '@/lib/cpf'
import { NOME_PLANO, PLANOS_PAGOS, PLANO_RECOMENDADO, DIAS_TESTE, DESCONTO_ANUAL_PCT, precoPorMes, precoCobrado, reais, type PlanoPago, type Ciclo } from '@/lib/planos-oferta'
import { ACQUISITION_OPTIONS } from '@/lib/cadastro-opcoes'
import { LEGAL_VERSION } from '@/lib/legal'
import { medir } from '@/lib/medicao'
import AddressFields from '@/components/AddressFields'
import { EMPTY_ADDRESS, addressError, normalizeAddress, type Address } from '@/lib/address'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  // Captura UTM/referrer no primeiro acesso ao signup (atribuição de aquisição).
  useEffect(() => { captureAttribution() }, [])
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [cpf, setCpf] = useState('')
  const [endereco, setEndereco] = useState<Address>(EMPTY_ADDRESS)
  // Plano e ciclo: o site pode pré-escolher (?plano=basico&ciclo=year).
  const [plano, setPlano] = useState<PlanoPago>(PLANO_RECOMENDADO)
  const [ciclo, setCiclo] = useState<Ciclo>('month')
  const [isInvite, setIsInvite] = useState(false)
  // Lido depois de montar (a página também renderiza no servidor, sem URL do
  // navegador): ler no estado inicial faria o HTML divergir na hidratação.
  /* eslint-disable react-hooks/set-state-in-effect -- ver acima */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const p = q.get('plano')
    if (p === 'basico' || p === 'familia' || p === 'plus') setPlano(p)
    if (q.get('ciclo') === 'year') setCiclo('year')
    setIsInvite(!!q.get('redirect')?.startsWith('/convite/'))
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */
  const [source, setSource] = useState('')
  const [terms, setTerms] = useState(false)
  const [consent, setConsent] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    if (!isValidPhoneBR(phone)) { setError('Celular inválido. Use DDD + número.'); return }
    if (!source) { setError('Conte como você nos conheceu.'); return }
    if (!isInvite && name.trim().split(/\s+/).filter(p => p.length >= 2).length < 2) { setError('Informe seu nome e sobrenome.'); return }
    if (!isInvite && !isValidCPF(cpf)) { setError('CPF inválido.'); return }
    const erroEndereco = isInvite ? null : addressError(normalizeAddress(endereco))
    if (erroEndereco) { setError(erroEndereco); return }
    if (!terms) { setError('É necessário aceitar os Termos de Uso e a Política de Privacidade.'); return }
    setLoading(true); setError('')

    // Tudo o que a conta grátis pede vai junto com a criação: o servidor grava
    // no perfil no primeiro acesso (ver src/lib/cadastro.ts). CPF e endereço
    // só são pedidos na hora de assinar.
    const cadastro = {
      full_name: name.trim(),
      family_name: familyName.trim() || 'Minha Família',
      phone,
      acquisition_source: source,
      marketing_consent: consent,
      terms_accepted: true,
      terms_version: LEGAL_VERSION,
      attribution: readAttribution(),
    }

    const params = new URLSearchParams(window.location.search)
    const redirect = params.get('redirect')
    if (isInvite && redirect) {
      // Fluxo de convite: cria usuário já confirmado via admin API e loga em seguida.
      // O token vai junto: o endpoint só confirma o e-mail automaticamente se
      // houver um convite pendente com ele. Sem isso a rota seria um criador
      // público de contas já confirmadas.
      const inviteToken = redirect!.replace('/convite/', '')
      const res = await fetch('/api/auth/signup-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, token: inviteToken, cadastro }),
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

      clearAttribution()
      medir('conta_criada')
      medir('cadastro_concluido', { convidado: true, origem: source })
      router.push('/dashboard')
      return
    }

    // Fluxo do modelo novo (teste de 14 dias com cartão): o servidor cria a
    // conta já confirmada, o navegador entra com a senha e segue direto para a
    // tela de pagamento do Stripe. A confirmação do e-mail não bloqueia: chega
    // por e-mail e o app lembra até a pessoa clicar (21/10/2026). O endereço vai
    // daqui para o Stripe, que então não o pede de novo. Ver /api/auth/cadastro.
    const res = await fetch('/api/auth/cadastro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: name, familia: familyName, email, senha: password, celular: phone, cpf,
        endereco: normalizeAddress(endereco),
        origem: source, marketing: consent, termos: terms, plano, ciclo,
        atribuicao: readAttribution(),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(body.error || 'Não foi possível criar a conta.'); setLoading(false); return }
    clearAttribution()
    medir('conta_criada')
    medir('cadastro_concluido', { convidado: false, origem: source, plano, periodo: ciclo })

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) { router.push('/auth/login?redirect=/assinar'); return }

    // Vai para a tela de pagamento. Se algo falhar aqui, a conta já existe: a
    // tela "Conclua sua assinatura" (/assinar) retoma do mesmo ponto.
    try {
      const r = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plano, interval: ciclo }),
      })
      const j = await r.json()
      if (r.ok && j.url) { window.location.href = j.url; return }
    } catch { /* cai no /assinar */ }
    router.push('/assinar')
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
            {isInvite ? 'Você foi convidado' : `${DIAS_TESTE} dias grátis`}
          </p>
          <h1 style={{ fontFamily: 'var(--font-gilda)', fontSize: 44, lineHeight: 1.2, color: '#1A1535' }}>
            Sua família<br/>merece o melhor<br/>da organização. 💚
          </h1>
          <p className="text-sm leading-relaxed mt-5" style={{ color: '#8585A8' }}>
            Crie sua conta em segundos e comece a organizar a rotina com inteligência artificial.
          </p>

          <div className="mt-8 space-y-3">
            {(isInvite
              ? ['Crie sua conta', 'Entre no ambiente da família', 'Acompanhe a rotina em tempo real']
              : ['Escolha seu plano', 'Cadastre o cartão — hoje R$ 0,00', 'Organize a rotina com IA']).map((s, i) => (
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

        <p className="text-xs" style={{ color: '#C0BFD5' }}>{isInvite ? '✓ Sem custo para quem é convidado' : `✓ ${DIAS_TESTE} dias grátis · ✓ Cancele quando quiser`}</p>
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
              <h2 style={{ fontFamily: 'var(--font-gilda)', fontSize: 30, color: '#1A1535', lineHeight: 1.2 }}>
                Crie sua conta
              </h2>
              <p className="text-sm mt-2" style={{ color: '#8585A8' }}>
                {isInvite
                  ? 'Quem é convidado não paga nada: você usa o plano de quem te convidou.'
                  : `${DIAS_TESTE} dias grátis em qualquer plano. Cancele quando quiser, sem cobrança durante o teste.`}
              </p>
            </div>

            <form onSubmit={handleSubmit} method="POST" className="space-y-4">
              {!isInvite && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-xs font-semibold" style={{ color: '#8585A8' }}>Seu plano</span>
                    <div className="flex rounded-full p-0.5" style={{ background: '#F0EEFF' }}>
                      {(['month', 'year'] as Ciclo[]).map(c => (
                        <button key={c} type="button" onClick={() => setCiclo(c)}
                          className="px-3 py-1 rounded-full text-[11px] font-bold transition-all"
                          style={ciclo === c ? { background: '#7B6FE8', color: '#fff' } : { color: '#8585A8' }}>
                          {c === 'month' ? 'Mensal' : `Anual (−${DESCONTO_ANUAL_PCT}%)`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {PLANOS_PAGOS.map(p => {
                      const sel = plano === p
                      return (
                        <button key={p} type="button" onClick={() => setPlano(p)}
                          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-left transition-all"
                          style={{ border: sel ? '2px solid #7B6FE8' : '1px solid #E8E4FF', background: sel ? '#F7F5FF' : '#fff' }}>
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-bold" style={{ color: '#1A1535' }}>{NOME_PLANO[p]}</span>
                            {p === PLANO_RECOMENDADO && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: '#7B6FE8', color: '#fff' }}>Recomendado</span>
                            )}
                          </span>
                          <span className="text-right">
                            <span className="block text-sm font-bold whitespace-nowrap" style={{ color: '#1A1535' }}>{reais(precoPorMes(p, ciclo))}<span className="text-[11px] font-semibold" style={{ color: '#8585A8' }}>/mês</span></span>
                            {ciclo === 'year' && <span className="block text-[10px]" style={{ color: '#8585A8' }}>{reais(precoCobrado(p, 'year'))} por ano</span>}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <a href="/#planos" target="_blank" className="block text-[11px] mt-2 underline" style={{ color: '#7B6FE8' }}>Comparar os planos</a>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#8585A8' }}>{isInvite ? 'Seu nome' : 'Nome e sobrenome'}</label>
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
                <label className="block text-xs font-semibold mb-1" style={{ color: '#8585A8' }}>Celular</label>
                <p className="text-xs mb-2" style={{ color: '#C0BFD5' }}>{isInvite
                  ? 'Você receberá os avisos da família no WhatsApp deste número.'
                  : 'Vamos usar este número para avisos da sua conta no WhatsApp (início e fim do teste, cobranças) e, nos planos Família e Plus, para o resumo diário da agenda.'}</p>
                <input type="tel" inputMode="numeric" autoComplete="tel-national" required value={phone}
                  onChange={e => setPhone(formatPhoneBR(e.target.value))}
                  placeholder="(11) 90000-0000" className="input-field" />
              </div>

              {!isInvite && (
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: '#8585A8' }}>CPF</label>
                  <p className="text-xs mb-2" style={{ color: '#C0BFD5' }}>Usamos o CPF na nota fiscal e para garantir um teste grátis por pessoa.</p>
                  <input type="text" inputMode="numeric" required value={cpf}
                    onChange={e => setCpf(formatCPF(e.target.value))}
                    placeholder="000.000.000-00" className="input-field" />
                </div>
              )}

              {!isInvite && (
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: '#8585A8' }}>Endereço</label>
                  <p className="text-xs mb-3" style={{ color: '#C0BFD5' }}>Para a nota fiscal. Digite o CEP e preenchemos o resto.</p>
                  <AddressFields value={endereco} onChange={setEndereco} />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#8585A8' }}>Senha</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} required value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres" className="input-field pr-11" />
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

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#8585A8' }}>Como você nos conheceu?</label>
                <select required value={source} onChange={e => setSource(e.target.value)} className="input-field">
                  <option value="" disabled>Selecione…</option>
                  {ACQUISITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)}
                  className="mt-0.5 flex-none" style={{ accentColor: '#7B6FE8', width: 16, height: 16 }} />
                <span className="text-xs leading-relaxed" style={{ color: '#6B6B8D' }}>
                  Li e aceito os{' '}
                  <a href="/termos" target="_blank" className="font-semibold underline" style={{ color: '#7B6FE8' }}>Termos de Uso</a>
                  {' '}e a{' '}
                  <a href="/privacidade" target="_blank" className="font-semibold underline" style={{ color: '#7B6FE8' }}>Política de Privacidade</a>, e declaro ter 18 anos ou mais.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                  className="mt-0.5 flex-none" style={{ accentColor: '#7B6FE8', width: 16, height: 16 }} />
                <span className="text-xs leading-relaxed" style={{ color: '#8585A8' }}>
                  Quero receber dicas, novidades e ofertas da Família em Dia por e-mail e WhatsApp. (opcional)
                </span>
              </label>

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
                  : <><span>{isInvite ? 'Criar conta' : 'Continuar para o pagamento'}</span><ArrowRight size={15} /></>
                }
              </button>
              {!isInvite && (
                <p className="text-[11px] text-center leading-relaxed" style={{ color: '#8585A8' }}>
                  Na próxima tela você cadastra o cartão. Hoje: R$ 0,00. Primeira cobrança só depois de {DIAS_TESTE} dias.
                </p>
              )}
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
