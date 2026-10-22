'use client'
import { useState } from 'react'
import { Check, Loader2, Star, Zap, Heart, Leaf, ExternalLink, CreditCard, PauseCircle } from 'lucide-react'
import type { PlanId, BillingInterval } from '@/lib/stripe'
import ComparativoPlanos from '@/components/billing/ComparativoPlanos'
import { medir } from '@/lib/medicao'
import {
  DESCONTO_ANUAL_PCT, PLANO_RECOMENDADO, precoPorMes, precoCobrado, reais, valorDaCobranca,
  type PlanoPago,
} from '@/lib/planos-oferta'

import { PLAN_LIMITS } from '@/lib/planos-limites'
import Modal from '@/components/ui/Modal'
import DadosAssinaturaModal from '@/components/billing/DadosAssinaturaModal'

// Rótulos de plano para exibição (local — não importar de billing.ts, que é server-only)
const PLAN_LABELS_UI: Record<PlanId, string> = {
  free: 'Gratuito',
  basico: 'Básico',
  familia: 'Família',
  plus: 'Família Plus',
  pausada: 'Conta pausada',
}

// Motivos de cancelamento (T12, obrigatório) — value bate com o enum do
// Stripe (cancellation_details.feedback); o Painel do negócio lê de lá.
const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: 'unused',           label: 'Não usei o suficiente' },
  { value: 'too_expensive',    label: 'Achei caro' },
  { value: 'missing_features', label: 'Faltou algum recurso' },
  { value: 'low_quality',      label: 'Tive problemas com o app' },
  { value: 'switched_service', label: 'Vou usar outra solução' },
  { value: 'other',            label: 'Outro' },
]

interface Props {
  oferta: 'v1' | 'v2'
  currentPlan: PlanId
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** Assinou durante o teste: cartão guardado, cobrança agendada. */
  assinouNoTeste?: boolean
  billingInterval: string | null
  isOwner: boolean
  ownerName?: string | null
  childLimit: number
  aiLimit: number
  /** Plano concedido sem assinatura no Stripe: nada a pagar, trocar ou cancelar. */
  cortesia?: boolean
  pauseReason?: string | null
  deleteAfter?: string | null
  paymentFailedAt?: string | null
  /** Veio do link "Atualizar cartão" (e-mail/WhatsApp de cartão recusado). */
  destacarCartao?: boolean
}

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`

// Cartões dos planos (T1). Recursos resumidos; a tabela completa vem abaixo.
const PLANS: { id: PlanoPago; name: string; tagline: string; icon: React.ElementType; iconColor: string; iconBg: string; features: { text: string; bold: boolean }[] }[] = [
  {
    id: 'basico', name: 'Básico',
    tagline: 'Para organizar a rotina dos filhos sozinho(a)',
    icon: Leaf, iconColor: '#5A8C5E', iconBg: 'linear-gradient(140deg,#EEF4EE,#DCEBDD)',
    features: [
      { text: 'Até 2 filhos', bold: false },
      { text: `${PLAN_LIMITS.basico.aiPerMonth} reconhecimentos de foto, print, texto e documentos por mês`, bold: false },
      { text: 'Cofre de documentos (200 MB)', bold: false },
      { text: 'Calendário, mensalidades e alertas no app', bold: false },
    ],
  },
  {
    id: 'familia', name: 'Família',
    tagline: 'Você + quem ajuda, com IA e WhatsApp',
    icon: Heart, iconColor: '#3D6641', iconBg: 'linear-gradient(140deg,#D4E8D5,#B8D9BA)',
    features: [
      { text: 'Até 3 filhos', bold: false },
      { text: 'Rede de apoio: você + 1 pessoa', bold: true },
      { text: 'Reconhecimento ilimitado de foto, print, texto e documentos', bold: true },
      { text: 'Reconhecimento por voz', bold: true },
      { text: 'Resumo diário no WhatsApp', bold: true },
      { text: 'Logística de leva e busca', bold: true },
      { text: 'Cofre de documentos (1 GB)', bold: true },
      { text: 'Calendário, mensalidades e alertas no app', bold: false },
    ],
  },
  {
    id: 'plus', name: 'Família Plus',
    tagline: 'Famílias maiores ou com avós, babá e escola no mesmo ambiente',
    icon: Zap, iconColor: '#C49A6C', iconBg: 'linear-gradient(140deg,#F5E6D3,#EDD4B8)',
    features: [
      { text: 'Tudo do plano Família', bold: true },
      { text: 'Filhos ilimitados', bold: true },
      { text: 'Rede de apoio ilimitada', bold: true },
      { text: 'Cofre de documentos (5 GB)', bold: true },
      { text: 'Suporte prioritário', bold: true },
    ],
  },
]

/**
 * De onde a pessoa veio para assinar: o botão do WhatsApp e o do e-mail levam
 * `utm_source`; sem ele, é a própria tela Planos do app. Guardado na sessão do
 * navegador para sobreviver ao modal de dados e a trocas de mensal/anual.
 */
type Origem = 'whatsapp' | 'email' | 'app'
function lerOrigem(): Origem {
  if (typeof window === 'undefined') return 'app'
  try {
    const utm = new URLSearchParams(window.location.search).get('utm_source')
    if (utm === 'whatsapp' || utm === 'email') { sessionStorage.setItem('fed-origem-assinatura', utm); return utm }
    const salva = sessionStorage.getItem('fed-origem-assinatura')
    return salva === 'whatsapp' || salva === 'email' ? salva : 'app'
  } catch { return 'app' }
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
}
function fmtDateShort(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

export default function PlanosClient({
  oferta, currentPlan, status, trialEndsAt, currentPeriodEnd,
  cancelAtPeriodEnd, billingInterval, isOwner, ownerName, childLimit, aiLimit,
  assinouNoTeste = false, cortesia = false, pauseReason = null, deleteAfter = null,
  paymentFailedAt = null, destacarCartao = false,
}: Props) {
  const v2 = oferta === 'v2'
  const [interval, setInterval] = useState<BillingInterval>(billingInterval === 'year' ? 'year' : 'month')
  const [loading,  setLoading]  = useState<string | null>(null)
  const [origem] = useState<Origem>(lerOrigem)
  const [error,    setError]    = useState<string | null>(null)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [canceladoAte, setCanceladoAte] = useState<string | null>(null)   // T13
  // Contratou sem teste e cancelou em até 7 dias da cobrança: valor devolvido (CDC art. 49).
  const [reembolsado, setReembolsado] = useState<number | null>(null)
  const [ajustes, setAjustes] = useState<{ plano: string; itens: string[] } | null>(null)  // T14
  // Plano que a pessoa tentou assinar sem ter nome completo, CPF e endereço.
  const [dadosPara, setDadosPara] = useState<PlanoPago | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelComment, setCancelComment] = useState('')

  const isTrialing  = status === 'trialing'
  const isPastDue   = status === 'past_due'
  const isPaused    = status === 'paused' || currentPlan === 'pausada'
  const isActive    = status === 'active' || isTrialing || isPastDue
  const isFree      = currentPlan === 'free'
  const temAssinatura = isActive && currentPlan !== 'free' && currentPlan !== 'pausada'
  // Assinatura de verdade no Stripe (o teste do modelo antigo não tem: é só
  // do app, sem ciclo nem cartão — a pessoa ainda precisa assinar).
  const assinaturaStripe = temAssinatura && (v2 || assinouNoTeste || !isTrialing) && billingInterval !== null
  // Assinante pagante — trocar de plano é upgrade/downgrade, nunca tem teste
  const isPaidActive = temAssinatura && (status === 'active' || isPastDue)
  // Cancelou durante o teste: nada será cobrado; o teste segue até o fim.
  const canceladaNoTeste = isTrialing && assinouNoTeste && cancelAtPeriodEnd
  const nomeAtual = PLAN_LABELS_UI[currentPlan]
  const planoPago = (['basico', 'familia', 'plus'].includes(currentPlan) ? currentPlan : 'familia') as PlanoPago
  const cicloAtual = billingInterval === 'year' ? 'year' : 'month'
  const valorAtual = valorDaCobranca(planoPago, cicloAtual).replace(/ por (mês|ano)$/, '')

  async function handleCheckout(plan: PlanoPago) {
    setLoading(plan)
    setError(null)
    medir('checkout_iniciado', { plano: plan, periodo: interval })
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval, origem }),
      })
      const data = await res.json()
      // Faltam os dados da nota fiscal: pede agora e retoma o mesmo plano.
      if (!res.ok && data.code === 'dados_pendentes') { setDadosPara(plan); setLoading(null); return }
      // Plano menor com filhos/rede acima do limite (T14).
      if (!res.ok && data.code === 'ajustar_conta') { setAjustes({ plano: PLAN_LABELS_UI[plan], itens: data.itens ?? [] }); setLoading(null); return }
      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar checkout')
      window.location.href = data.url
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      setLoading(null)
    }
  }

  async function handlePortal() {
    setLoading('portal')
    setError(null)
    try {
      const res  = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao abrir portal')
      window.location.href = data.url
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      setLoading(null)
    }
  }

  async function handleCancel() {
    if (!cancelReason) return
    setLoading('cancel')
    setError(null)
    try {
      const res  = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactivate: false, reason: cancelReason, comment: cancelComment || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cancelar')
      setCancelModalOpen(false)
      setLoading(null)
      // T13 — confirmação clara antes de recarregar a tela.
      if (typeof data.reembolsado === 'number' && data.reembolsado > 0) setReembolsado(data.reembolsado)
      setCanceladoAte((isTrialing ? trialEndsAt : currentPeriodEnd) ?? '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      setLoading(null)
      setCancelModalOpen(false)
    }
  }

  async function handleReactivate() {
    setLoading('reactivate')
    setError(null)
    try {
      const res  = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactivate: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao reativar')
      window.location.reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      setLoading(null)
    }
  }

  const cardBox: React.CSSProperties = {
    background: `${NOISE}, linear-gradient(160deg,#FFFFFF,#FAFAF7)`,
    backgroundSize: '200px 200px, 100% 100%',
    border: '1px solid rgba(61,102,65,0.20)',
    boxShadow: '0 2px 12px rgba(44,74,46,0.07)',
  }

  // Conta cortesia: os botões de assinar, trocar e cancelar abririam uma
  // cobrança real ou falhariam (não existe assinatura por trás).
  if (cortesia && isOwner) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="animate-fade-up">
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#3D6641' }}>Assinatura</p>
          <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 30, fontWeight: 700, color: '#1A2B1C', lineHeight: 1.1 }}>Planos</h1>
        </div>
        <div className="animate-fade-up rounded-2xl p-5" style={cardBox}>
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(26,43,28,0.40)' }}>Plano atual</p>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1A2B1C' }}>{nomeAtual}</span>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(255,107,92,0.12)', color: '#B5432A' }}>Cortesia</span>
          </div>
          <p className="text-sm mt-2" style={{ color: 'rgba(26,43,28,0.60)', lineHeight: 1.55 }}>
            Acesso completo, sem cobrança. Esta conta não tem assinatura: não há nada a pagar, renovar ou cancelar.
          </p>
        </div>
      </div>
    )
  }

  // Selo do plano atual
  const selo = isPaused ? { txt: 'Pausada', bg: 'rgba(245,158,11,0.14)', cor: '#92400E' }
    : isPastDue ? { txt: 'Pagamento pendente', bg: 'rgba(245,158,11,0.14)', cor: '#92400E' }
    : canceladaNoTeste ? { txt: 'Cancelada', bg: 'rgba(220,38,38,0.10)', cor: '#DC2626' }
    : isTrialing ? { txt: v2 || assinouNoTeste ? 'Em teste' : 'Em teste', bg: 'rgba(245,158,11,0.12)', cor: '#92400E' }
    : cancelAtPeriodEnd ? { txt: 'Cancelando', bg: 'rgba(220,38,38,0.10)', cor: '#DC2626' }
    : { txt: 'Ativo', bg: 'rgba(61,102,65,0.10)', cor: '#2C4A2E' }

  const limiteCartao = paymentFailedAt ? fmtDate(new Date(new Date(paymentFailedAt).getTime() + 7 * 86_400_000).toISOString()) : ''

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="animate-fade-up">
        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#3D6641' }}>Assinatura</p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 30, fontWeight: 700, color: '#1A2B1C', lineHeight: 1.1 }}>Planos</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(26,43,28,0.45)' }}>Escolha o plano ideal para a sua família</p>
      </div>

      {/* Conta pausada (modelo novo) — T16 */}
      {isPaused && isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={{ background: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', border: '1px solid rgba(245,158,11,0.40)' }}>
          <div className="flex items-start gap-3">
            <PauseCircle size={20} color="#92400E" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#92400E', margin: 0 }}>Sua conta está pausada.</p>
              <p className="text-sm mt-1" style={{ color: '#92400E', lineHeight: 1.5 }}>
                {pauseReason === 'pagamento' ? 'Não conseguimos cobrar o cartão.' : 'A assinatura foi cancelada.'}{' '}
                Você ainda pode ver sua agenda e seus documentos, mas não pode criar nem editar. Seus dados ficam guardados até <strong>{fmtDate(deleteAfter)}</strong>; depois disso, a conta é apagada.
              </p>
              <a href="/assinar?reativar=1" className="inline-block mt-3 px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(140deg,#F59E0B,#D97706)', textDecoration: 'none' }}>
                Reativar assinatura
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Status atual — só o owner vê */}
      {temAssinatura && isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={cardBox}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(26,43,28,0.40)' }}>Plano atual</p>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 16, fontWeight: 700, color: '#1A2B1C' }}>{nomeAtual}</span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: selo.bg, color: selo.cor }}>{selo.txt}</span>
              </div>
              {isTrialing && trialEndsAt && (
                <p className="text-xs mt-1" style={{ color: 'rgba(26,43,28,0.55)' }}>
                  {canceladaNoTeste ? (
                    <><strong style={{ color: '#2C4A2E' }}>Assinatura cancelada · nenhuma cobrança será feita.</strong> Você usa o plano até {fmtDate(trialEndsAt)}.</>
                  ) : assinouNoTeste ? (
                    <>Teste grátis até {fmtDate(trialEndsAt)} · <strong style={{ color: '#2C4A2E' }}>primeira cobrança de {valorAtual} em {fmtDateShort(trialEndsAt)}</strong>.</>
                  ) : (
                    <>Teste gratuito até {fmtDate(trialEndsAt)}</>
                  )}
                </p>
              )}
              {isPastDue && (
                <p className="text-xs mt-1" style={{ color: '#92400E' }}>
                  <strong>Não conseguimos cobrar seu cartão.</strong> Atualize até {limiteCartao} para não pausar a conta.
                </p>
              )}
              {!isTrialing && !isPastDue && currentPeriodEnd && (
                <p className="text-xs mt-1" style={{ color: 'rgba(26,43,28,0.55)' }}>
                  {cancelAtPeriodEnd
                    ? <><strong style={{ color: '#2C4A2E' }}>Sem novas cobranças.</strong> Seu acesso continua até {fmtDate(currentPeriodEnd)}.</>
                    : `Renova em ${fmtDate(currentPeriodEnd)}`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handlePortal} disabled={!!loading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60"
                style={isPastDue || destacarCartao
                  ? { background: 'linear-gradient(140deg,#F59E0B,#D97706)', color: '#fff', border: 'none', cursor: 'pointer' }
                  : { background: 'rgba(61,102,65,0.10)', color: '#2C4A2E', border: 'none', cursor: 'pointer' }}>
                {loading === 'portal' ? <Loader2 size={14} className="animate-spin" /> : isPastDue || destacarCartao ? <CreditCard size={14} /> : <ExternalLink size={14} />}
                {isPastDue || destacarCartao ? 'Atualizar cartão' : 'Faturas e pagamento'}
              </button>
              {/* O portal do Stripe tem o cancelamento desligado: este é o único
                  caminho. O teste do modelo antigo sem assinatura não tem o que cancelar. */}
              {(!isTrialing || assinouNoTeste) && (cancelAtPeriodEnd ? (
                <button onClick={handleReactivate} disabled={!!loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60"
                  style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: 'white', border: 'none', cursor: 'pointer' }}>
                  {loading === 'reactivate' && <Loader2 size={14} className="animate-spin" />}
                  Reativar assinatura
                </button>
              ) : (
                <button onClick={() => setCancelModalOpen(true)} disabled={!!loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60"
                  style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: 'none', cursor: 'pointer' }}>
                  {loading === 'cancel' && <Loader2 size={14} className="animate-spin" />}
                  Cancelar assinatura
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Gratuito do modelo antigo — status */}
      {isFree && isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={{ background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.14)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(26,43,28,0.40)' }}>Plano atual</p>
          <div className="flex items-center gap-3 flex-wrap justify-between">
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#1A2B1C', margin: 0 }}>Gratuito</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(26,43,28,0.50)' }}>
                Até {childLimit} filhos · {aiLimit} reconhecimentos/mês · sem voz · sem WhatsApp · sem rede de apoio
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E' }}>Ativo</span>
          </div>
        </div>
      )}

      {/* Toggle mensal / anual */}
      {isOwner && !isPaused && (
        <div className="animate-fade-up flex items-center justify-center gap-1 p-1 rounded-2xl self-start mx-auto w-fit"
          style={{ background: 'rgba(61,102,65,0.08)', border: '1px solid rgba(61,102,65,0.14)' }}>
          {(['month', 'year'] as BillingInterval[]).map(iv => (
            <button key={iv} onClick={() => setInterval(iv)}
              className="px-5 py-2 rounded-xl text-sm font-bold transition-all"
              style={{ background: interval === iv ? '#14463A' : 'transparent', color: interval === iv ? 'white' : 'rgba(26,43,28,0.55)', border: 'none', cursor: 'pointer' }}>
              {iv === 'month' ? 'Mensal' : 'Anual'}
              {iv === 'year' && (
                <span className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background: interval === 'year' ? 'rgba(255,255,255,0.22)' : 'rgba(61,102,65,0.12)', color: interval === 'year' ? 'white' : '#3D6641' }}>
                  −{DESCONTO_ANUAL_PCT}%
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Cards dos planos */}
      {isOwner && !isPaused && (
        <div className="animate-fade-up space-y-4">
          {PLANS.map(plan => {
            const rec = plan.id === PLANO_RECOMENDADO
            // "Plano atual" só quando plano E intervalo batem.
            const isCurrentPlan = assinaturaStripe && currentPlan === plan.id && cicloAtual === interval
            const samePlanDiffInterval = currentPlan === plan.id && isPaidActive && cicloAtual !== interval
            const price = precoPorMes(plan.id, interval)
            const Icon  = plan.icon
            const rotulo = samePlanDiffInterval
              ? `Mudar para ${interval === 'year' ? 'anual' : 'mensal'}`
              : assinaturaStripe ? `Mudar para ${plan.name}` : `Assinar plano ${plan.name}`

            return (
              <div key={plan.id}
                style={{
                  borderRadius: '17px 11px 15px 13px',
                  background: rec ? `${NOISE}, linear-gradient(160deg,#F4FAF4,#E9F3EA)` : `${NOISE}, linear-gradient(160deg,#FFFFFF,#FAFAF7)`,
                  backgroundSize: '200px 200px, 100% 100%',
                  border: rec ? '1.5px solid rgba(61,102,65,0.40)' : '1px solid rgba(61,102,65,0.18)',
                  boxShadow: rec ? '0 6px 24px rgba(61,102,65,0.16)' : '0 4px 16px rgba(44,74,46,0.08)',
                  padding: '20px 20px 18px',
                }}>

                {rec && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <Star size={12} color="#3D6641" fill="#3D6641" />
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#3D6641', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recomendado</span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: plan.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={20} color={plan.iconColor} />
                    </div>
                    <div>
                      <p style={{ fontSize: 18, fontWeight: 700, color: '#1A2B1C', margin: 0 }}>{plan.name}</p>
                      <p style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)', margin: 0, lineHeight: 1.4 }}>{plan.tagline}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {interval === 'year' && (
                      <p style={{ fontSize: 12, color: 'rgba(26,43,28,0.40)', margin: '0 0 2px', textDecoration: 'line-through', whiteSpace: 'nowrap' }}>
                        {reais(precoPorMes(plan.id, 'month'))}
                      </p>
                    )}
                    <p style={{ fontSize: 24, fontWeight: 800, color: '#1A2B1C', margin: 0, lineHeight: 1, whiteSpace: 'nowrap' }}>{reais(price)}</p>
                    <p style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)', margin: '3px 0 0' }}>
                      /mês
                      {interval === 'year' && <span style={{ display: 'block', whiteSpace: 'nowrap' }}>{reais(precoCobrado(plan.id, 'year'))} por ano</span>}
                    </p>
                  </div>
                </div>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {plan.features.map(f => (
                    <li key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, background: 'rgba(61,102,65,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={11} color="#3D6641" strokeWidth={2.5} />
                      </div>
                      <span style={{ fontSize: 13, color: f.bold ? '#1A2B1C' : 'rgba(26,43,28,0.65)', fontWeight: f.bold ? 600 : 400 }}>{f.text}</span>
                    </li>
                  ))}
                </ul>

                {isCurrentPlan ? (
                  <div className="flex items-center justify-center gap-2 py-3 rounded-[13px] text-sm font-bold" style={{ background: 'rgba(61,102,65,0.08)', color: '#3D6641' }}>
                    <Check size={15} strokeWidth={2.5} />
                    {isTrialing ? (canceladaNoTeste ? 'Cancelado · sem cobrança' : `Seu plano · em teste até ${fmtDateShort(trialEndsAt)}`) : 'Plano atual'}
                  </div>
                ) : (
                  <button onClick={() => handleCheckout(plan.id)} disabled={!!loading}
                    className="w-full py-3 rounded-[13px] text-sm font-bold text-white transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', boxShadow: '0 4px 16px rgba(255,107,92,0.32)', border: 'none', cursor: loading ? 'wait' : 'pointer' }}>
                    {loading === plan.id ? <><Loader2 size={15} className="animate-spin" /> Aguarde...</> : rotulo}
                  </button>
                )}
                {!isCurrentPlan && isTrialing && v2 && (
                  <p style={{ fontSize: 11.5, color: 'rgba(26,43,28,0.50)', margin: '8px 0 0', textAlign: 'center' }}>
                    Muda agora e já pode usar. Seu teste continua até {fmtDateShort(trialEndsAt)}; a primeira cobrança será de {reais(precoCobrado(plan.id, interval))}.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Parceiro — herda o plano do owner, não gerencia assinatura */}
      {!isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={{ background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.14)' }}>
          <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.65)', margin: 0, lineHeight: 1.5 }}>
            Você está usando como parceiro{ownerName ? ` de ${ownerName}` : ''}. O plano <strong>{PLAN_LABELS_UI[currentPlan]}</strong>{' '}
            {isFree || isPaused
              ? 'é o ambiente compartilhado pelo responsável principal.'
              : 'é gerenciado pelo responsável principal — você tem acesso a todos os recursos do plano.'}
          </p>
        </div>
      )}

      {error && (
        <div className="animate-fade-up text-sm font-semibold px-4 py-3 rounded-2xl flex items-center gap-2"
          style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.20)' }}>
          {error}
        </div>
      )}

      {isOwner && (
        <>
          <p className="text-center text-xs animate-fade-up" style={{ color: 'rgba(26,43,28,0.35)' }}>
            Pagamento seguro via Stripe · Cancele quando quiser · Sem fidelidade
          </p>
          <ComparativoPlanos />
        </>
      )}

      <DadosAssinaturaModal
        open={dadosPara !== null}
        onClose={() => setDadosPara(null)}
        onSalvo={() => { const plano = dadosPara; setDadosPara(null); if (plano) handleCheckout(plano) }}
      />

      {/* T14 — ajustar a conta antes de mudar para um plano menor */}
      <Modal open={ajustes !== null} onClose={() => setAjustes(null)} title={`Antes de mudar para o ${ajustes?.plano ?? ''}`} size="sm">
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.70)' }}>Ajuste a conta:</p>
          <ul style={{ paddingLeft: 18, margin: 0 }} className="text-sm space-y-1">
            {ajustes?.itens.map(i => <li key={i} style={{ color: '#1A2B1C' }}>{i};</li>)}
          </ul>
          <p className="text-xs" style={{ color: 'rgba(26,43,28,0.55)', lineHeight: 1.5 }}>
            Seus arquivos do cofre continuam guardados; só novos envios ficam bloqueados se passar do espaço do plano.
          </p>
          <button onClick={() => setAjustes(null)} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E', border: 'none', cursor: 'pointer' }}>Entendi</button>
        </div>
      </Modal>

      {/* T13 — confirmação de cancelamento */}
      <Modal open={canceladoAte !== null} onClose={() => window.location.reload()} title="Sua assinatura foi cancelada." size="sm">
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.75)', lineHeight: 1.55 }}>
            {reembolsado !== null
              ? <>Como a contratação foi há menos de 7 dias, devolvemos <strong>{(reembolsado / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong> no seu cartão (pode levar alguns dias para aparecer na fatura). O acesso ao plano foi encerrado.</>
              : isTrialing
              ? <>Nenhuma cobrança será feita. Você continua usando o plano {nomeAtual} normalmente até <strong>{fmtDateShort(canceladoAte)}</strong>.</>
              : <>Não haverá novas cobranças. Você continua usando o plano {nomeAtual} até <strong>{fmtDateShort(canceladoAte)}</strong>, fim do período já pago.</>}
          </p>
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.75)' }}>Mudou de ideia? Reative quando quiser, nesta mesma tela.</p>
          <button onClick={() => window.location.reload()} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E', border: 'none', cursor: 'pointer' }}>OK</button>
        </div>
      </Modal>

      {/* Modal de cancelamento — T12, motivo obrigatório */}
      <Modal open={cancelModalOpen} onClose={() => { if (loading !== 'cancel') setCancelModalOpen(false) }} title="Cancelar a assinatura?" size="sm">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.65)', lineHeight: 1.5 }}>
            {isTrialing ? (
              v2
                ? <>Nenhuma cobrança será feita e você continua usando o plano {nomeAtual} até <strong>{fmtDateShort(trialEndsAt)}</strong>. Depois disso, a conta é pausada: seus dados ficam guardados por 90 dias.</>
                : <><strong>Nada foi cobrado e nada será.</strong> Seu teste gratuito continua até <strong>{fmtDate(trialEndsAt)}</strong>; depois dessa data a conta passa para o plano gratuito.</>
            ) : (
              v2
                ? <>Você continua usando até <strong>{fmtDateShort(currentPeriodEnd)}</strong>, sem novas cobranças. Depois disso, a conta é pausada: seus dados ficam guardados por 90 dias.</>
                : <><strong>Nenhuma nova cobrança será feita.</strong> Você mantém o acesso completo até <strong>{fmtDate(currentPeriodEnd)}</strong>, que já está pago.</>
            )}
          </p>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'rgba(26,43,28,0.45)' }}>Por que você está cancelando?</p>
            <div className="space-y-1.5">
              {CANCEL_REASONS.map(r => (
                <label key={r.value} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                  style={{ background: cancelReason === r.value ? 'rgba(61,102,65,0.10)' : 'rgba(61,102,65,0.04)', border: `1px solid ${cancelReason === r.value ? 'rgba(61,102,65,0.35)' : 'rgba(61,102,65,0.12)'}` }}>
                  <input type="radio" name="cancel-reason" value={r.value} checked={cancelReason === r.value} onChange={() => setCancelReason(r.value)} style={{ accentColor: '#3D6641' }} />
                  <span className="text-sm" style={{ color: '#1A2B1C' }}>{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          <textarea value={cancelComment} onChange={e => setCancelComment(e.target.value)}
            placeholder="Quer deixar um comentário? (opcional)" rows={3} maxLength={500}
            className="w-full px-3 py-2.5 rounded-xl text-sm resize-none"
            style={{ background: 'white', border: '1px solid rgba(61,102,65,0.18)', color: '#1A2B1C', outline: 'none' }} />

          <div className="flex gap-2 pt-1">
            <button onClick={() => setCancelModalOpen(false)} disabled={loading === 'cancel'}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60"
              style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E', border: 'none', cursor: 'pointer' }}>
              Manter
            </button>
            <button onClick={handleCancel} disabled={loading === 'cancel' || !cancelReason}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626', border: 'none', cursor: cancelReason ? 'pointer' : 'not-allowed' }}>
              {loading === 'cancel' && <Loader2 size={14} className="animate-spin" />}
              Cancelar assinatura
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
