'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import DadosAssinaturaModal from '@/components/billing/DadosAssinaturaModal'
import {
  NOME_PLANO, PLANOS_PAGOS, PLANO_RECOMENDADO, DIAS_TESTE, DESCONTO_ANUAL_PCT,
  precoPorMes, precoCobrado, reais, type PlanoPago, type Ciclo,
} from '@/lib/planos-oferta'

export type Modo = 'concluir' | 'cartao_usado' | 'reativar' | 'herdou'

const TEXTOS: Record<Modo, { titulo: string; texto: (p: string, v: string) => string; botao: string }> = {
  // T7
  concluir: {
    titulo: 'Falta pouco para começar.',
    texto: () => `Sua conta foi criada, mas a assinatura ainda não foi concluída. Escolha o plano e cadastre o cartão para liberar seus ${DIAS_TESTE} dias grátis — hoje não há cobrança.`,
    botao: 'Continuar cadastro',
  },
  // T5
  cartao_usado: {
    titulo: 'Este cartão já foi usado em um teste grátis.',
    texto: (p, v) => `O teste de ${DIAS_TESTE} dias vale uma vez por pessoa. Você pode assinar o plano ${p} agora, sem teste — a primeira cobrança de ${v} será feita hoje.`,
    botao: 'Assinar sem teste',
  },
  // Conta pausada
  reativar: {
    titulo: 'Reative sua assinatura.',
    texto: (p, v) => `Escolha o plano para voltar a usar tudo. A assinatura começa hoje, sem novo teste: a primeira cobrança de ${v} (plano ${p}) é feita agora.`,
    botao: 'Reativar assinatura',
  },
  // Família herdada: o dono anterior excluiu a conta (excluir-conta.ts)
  herdou: {
    titulo: 'Esta família agora é sua.',
    texto: (p, v) => `Quem criou a família saiu do Família em Dia, e ela passou para você, com todos os dados. Para voltar a criar e editar, escolha um plano: a assinatura começa hoje, com a primeira cobrança de ${v} (plano ${p}).`,
    botao: 'Assinar',
  },
}

export default function AssinarClient({ modo, planoInicial, cicloInicial, voltouDoStripe }: {
  modo: Modo; planoInicial: PlanoPago; cicloInicial: Ciclo; voltouDoStripe: boolean
}) {
  const router = useRouter()
  const [plano, setPlano] = useState<PlanoPago>(planoInicial)
  const [ciclo, setCiclo] = useState<Ciclo>(cicloInicial)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  // Quem entrou por convite não informou CPF nem endereço: o checkout pede antes.
  const [pedirDados, setPedirDados] = useState(false)
  const t = TEXTOS[modo]
  const valorHoje = reais(precoCobrado(plano, ciclo))

  async function continuar() {
    setLoading(true); setErro('')
    try {
      const r = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plano, interval: ciclo, semTeste: modo === 'cartao_usado' }),
      })
      const j = await r.json()
      if (r.ok && j.url) { window.location.href = j.url; return }
      if (j.code === 'dados_pendentes') { setPedirDados(true); setLoading(false); return }
      setErro(j.error || 'Não foi possível abrir o pagamento. Tente de novo.')
    } catch {
      setErro('Sem conexão. Tente de novo.')
    }
    setLoading(false)
  }

  async function sair() {
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F7F5FF' }}>
      <div className="w-full max-w-md bg-white rounded-3xl p-8" style={{ boxShadow: '0 24px 80px rgba(123,111,232,0.12), 0 0 0 1px rgba(123,111,232,0.08)' }}>
        <img src="/brand/lockup-claro.png" alt="Família em Dia" style={{ height: 34, width: 'auto', display: 'block', marginBottom: 20 }} />
        <h1 style={{ fontFamily: 'var(--font-gilda)', fontSize: 26, color: '#1A1535', lineHeight: 1.25 }}>{t.titulo}</h1>
        <p className="text-sm mt-3 leading-relaxed" style={{ color: '#6B6B8D' }}>{t.texto(NOME_PLANO[plano], valorHoje)}</p>
        {voltouDoStripe && modo === 'concluir' && (
          <p className="text-xs mt-3 px-3 py-2 rounded-xl" style={{ background: '#FFF8E6', color: '#8A6100' }}>
            O pagamento não foi concluído. Nada foi cobrado — é só continuar quando quiser.
          </p>
        )}

        {modo !== 'cartao_usado' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: '#8585A8' }}>Seu plano</span>
              <div className="flex rounded-full p-0.5" style={{ background: '#F0EEFF' }}>
                {(['month', 'year'] as Ciclo[]).map(c => (
                  <button key={c} type="button" onClick={() => setCiclo(c)}
                    className="px-3 py-1 rounded-full text-[11px] font-bold"
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
                    className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-left"
                    style={{ border: sel ? '2px solid #7B6FE8' : '1px solid #E8E4FF', background: sel ? '#F7F5FF' : '#fff' }}>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: '#1A1535' }}>{NOME_PLANO[p]}</span>
                      {p === PLANO_RECOMENDADO && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: '#7B6FE8', color: '#fff' }}>Recomendado</span>}
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-bold whitespace-nowrap" style={{ color: '#1A1535' }}>{reais(precoPorMes(p, ciclo))}<span className="text-[11px] font-semibold" style={{ color: '#8585A8' }}>/mês</span></span>
                      {ciclo === 'year' && <span className="block text-[10px]" style={{ color: '#8585A8' }}>{reais(precoCobrado(p, 'year'))} por ano</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {erro && <p className="text-xs font-semibold mt-4 px-4 py-3 rounded-2xl" style={{ background: '#FFF0F4', color: '#C0405A' }}>⚠ {erro}</p>}

        <button onClick={continuar} disabled={loading}
          className="w-full mt-6 py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#7B6FE8,#C084FC)', boxShadow: '0 8px 28px rgba(123,111,232,0.30)' }}>
          {loading ? 'Abrindo o pagamento…' : t.botao}
        </button>
        {modo === 'concluir' && (
          <p className="text-[11px] text-center mt-3" style={{ color: '#8585A8' }}>Hoje: R$ 0,00. Primeira cobrança só depois de {DIAS_TESTE} dias.</p>
        )}

        <div className="flex justify-center gap-4 mt-5 text-xs">
          {modo === 'cartao_usado' && (
            <button onClick={() => router.push('/assinar')} className="font-semibold" style={{ color: '#7B6FE8' }}>Voltar</button>
          )}
          {(modo === 'reativar' || modo === 'herdou') && (
            <button onClick={() => router.push('/dashboard')} className="font-semibold" style={{ color: '#7B6FE8' }}>Ver meus dados</button>
          )}
          <button onClick={sair} style={{ color: '#8585A8' }}>Sair</button>
        </div>
      </div>
      <DadosAssinaturaModal open={pedirDados} onClose={() => setPedirDados(false)} onSalvo={() => { setPedirDados(false); continuar() }} />
    </div>
  )
}
