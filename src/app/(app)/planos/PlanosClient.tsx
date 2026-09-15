'use client'
import { useState } from 'react'
import { Check, Loader2, Star, Zap, Heart, ExternalLink } from 'lucide-react'
import type { PlanId, BillingInterval } from '@/lib/stripe'
import type { PlanPrices } from './page'
import Modal from '@/components/ui/Modal'

// Rótulos de plano para exibição (local — não importar de billing.ts, que é server-only)
const PLAN_LABELS_UI: Record<PlanId, string> = {
  free: 'Gratuito',
  familia: 'Família',
  plus: 'Família Plus',
}

// Motivos de cancelamento — value bate com o enum do Stripe (cancellation_details.feedback)
const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: 'too_expensive',    label: 'Está caro para o meu momento' },
  { value: 'unused',           label: 'Não estou usando o suficiente' },
  { value: 'missing_features', label: 'Faltam funcionalidades que preciso' },
  { value: 'switched_service', label: 'Vou usar outro app/serviço' },
  { value: 'too_complex',      label: 'Achei complicado de usar' },
  { value: 'other',            label: 'Outro motivo' },
]

interface Props {
  currentPlan: PlanId
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** Fim da janela de arrependimento (7 dias), ou null se fora dela. */
  arrependimentoAte?: string | null
  /** Assinou durante o teste: cartão guardado, cobrança agendada. */
  assinouNoTeste?: boolean
  billingInterval: string | null
  isOwner: boolean
  ownerName?: string | null
  childLimit: number
  aiLimit: number
  prices: PlanPrices
}

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`

const PLANS = [
  {
    id: 'familia' as PlanId,
    name: 'Família',
    tagline: 'Para famílias que querem organização real com IA e parceiro',
    icon: Heart,
    iconColor: '#3D6641',
    iconBg: 'linear-gradient(140deg,#D4E8D5,#B8D9BA)',
    highlight: false,
    features: [
      { text: 'Até 2 filhos', bold: false },
      { text: 'IA texto + foto ilimitado', bold: true },
      { text: 'Entrada por voz ilimitado', bold: true },
      { text: 'Cofre de documentos inteligente (500 MB)', bold: true },
      { text: 'Resumo diário via WhatsApp', bold: true },
      { text: '1 parceiro com acesso compartilhado', bold: true },
      { text: 'Logística leva/busca', bold: true },
      { text: 'Alertas de vencimento de documentos', bold: false },
    ],
  },
  {
    id: 'plus' as PlanId,
    name: 'Família Plus',
    tagline: 'Famílias maiores ou com avós, babá e escola no mesmo ambiente',
    icon: Zap,
    iconColor: '#C49A6C',
    iconBg: 'linear-gradient(140deg,#F5E6D3,#EDD4B8)',
    highlight: true,
    features: [
      { text: 'Tudo do plano Família', bold: true },
      { text: 'Filhos ilimitados', bold: true },
      { text: 'Parceiros ilimitados', bold: true },
      { text: 'Cofre de documentos inteligente (5 GB)', bold: true },
      { text: 'Suporte prioritário', bold: true },
      { text: 'Histórico completo de atividades', bold: false },
    ],
  },
]

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function fmtDateShort(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function fmtPrice(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

export default function PlanosClient({
  currentPlan, status, trialEndsAt, currentPeriodEnd,
  cancelAtPeriodEnd, billingInterval, isOwner, ownerName, childLimit, aiLimit, prices,
  arrependimentoAte = null, assinouNoTeste = false,
}: Props) {
  // Toggle abre no intervalo do plano atual do usuário; sem plano pago (grátis/
  // cancelado) cai no padrão mensal.
  const [interval, setInterval] = useState<BillingInterval>(
    billingInterval === 'year' ? 'year' : 'month',
  )
  const [loading,  setLoading]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelComment, setCancelComment] = useState('')

  const isTrialing  = status === 'trialing'
  const isActive    = status === 'active' || isTrialing
  const isFree      = currentPlan === 'free'
  // Usuário em trial já usou os 14 dias gratuitos — checkout sem novo trial
  const trialDone   = isFree && status === 'free'
  // Assinante pagante ativo — trocar de plano é upgrade/downgrade, nunca tem trial
  const isPaidActive = currentPlan !== 'free' && status === 'active'

  async function handleCheckout(plan: PlanId) {
    setLoading(plan)
    setError(null)
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      })
      const data = await res.json()
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
    setLoading('cancel')
    setError(null)
    try {
      const res  = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reactivate: false,
          reason: cancelReason || undefined,
          comment: cancelComment || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cancelar')
      window.location.reload()
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="animate-fade-up">
        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#3D6641' }}>Assinatura</p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 30, fontWeight: 700, color: '#1A2B1C', lineHeight: 1.1 }}>
          Planos
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(26,43,28,0.45)' }}>
          Escolha o plano ideal para a sua família
        </p>
      </div>

      {/* Status atual — só o owner vê (parceiro vê o card de parceiro abaixo) */}
      {!isFree && isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={{
          background: `${NOISE}, linear-gradient(160deg,#FFFFFF,#FAFAF7)`,
          backgroundSize: '200px 200px, 100% 100%',
          border: '1px solid rgba(61,102,65,0.20)',
          boxShadow: '0 2px 12px rgba(44,74,46,0.07)',
        }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(26,43,28,0.40)' }}>
                Plano atual
              </p>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 16, fontWeight: 700, color: '#1A2B1C' }}>
                  {currentPlan === 'familia' ? 'Família' : 'Família Plus'}
                </span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{
                  background: isTrialing
                    ? 'rgba(245,158,11,0.12)'
                    : cancelAtPeriodEnd
                      ? 'rgba(220,38,38,0.10)'
                      : 'rgba(61,102,65,0.10)',
                  color: isTrialing ? '#92400E' : cancelAtPeriodEnd ? '#DC2626' : '#2C4A2E',
                }}>
                  {isTrialing ? (assinouNoTeste ? 'Assinado' : 'Em teste') : cancelAtPeriodEnd ? 'Cancelando' : 'Ativo'}
                </span>
              </div>
              {isTrialing && trialEndsAt && (
                <p className="text-xs mt-1" style={{ color: 'rgba(26,43,28,0.50)' }}>
                  {assinouNoTeste ? (
                    <>
                      <strong style={{ color: '#2C4A2E' }}>Assinatura confirmada.</strong>{' '}
                      Grátis até {fmtDate(trialEndsAt)} — a cobrança começa nessa data.
                    </>
                  ) : (
                    <>Teste gratuito até {fmtDate(trialEndsAt)}</>
                  )}
                </p>
              )}
              {!isTrialing && currentPeriodEnd && (
                // "Cancelando" + "Acesso até <data>" estava correto, mas deixava
                // no ar a pergunta que o próprio Rogério fez ao testar: "então
                // eu continuo sendo cobrado até lá?". Não continua — o período
                // já foi pago e não haverá nova cobrança. Dizer isso explicita
                // o que o selo só insinuava.
                <p className="text-xs mt-1" style={{ color: 'rgba(26,43,28,0.50)' }}>
                  {cancelAtPeriodEnd
                    ? <><strong style={{ color: '#2C4A2E' }}>Sem novas cobranças.</strong> Seu acesso continua até {fmtDate(currentPeriodEnd)}.</>
                    : `Renova em ${fmtDate(currentPeriodEnd)}`}
                </p>
              )}
            </div>
            {isOwner && (
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handlePortal} disabled={!!loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60"
                  style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E', border: 'none', cursor: 'pointer' }}>
                  {loading === 'portal'
                    ? <Loader2 size={14} className="animate-spin" />
                    : <ExternalLink size={14} />}
                  Faturas e pagamento
                </button>
                {!isTrialing && (cancelAtPeriodEnd ? (
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
            )}
          </div>
        </div>
      )}

      {/* Plano free — status (só owner vê o enquadramento de "assinar") */}
      {isFree && isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={{
          background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.14)',
        }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(26,43,28,0.40)' }}>
            Plano atual
          </p>
          <div className="flex items-center gap-3 flex-wrap justify-between">
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#1A2B1C', margin: 0 }}>Gratuito</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(26,43,28,0.50)' }}>
                Até {childLimit} filhos · {aiLimit} capturas de IA/mês · sem voz · sem WhatsApp · sem compartilhamento
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1 rounded-full"
              style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E' }}>
              Ativo
            </span>
          </div>
        </div>
      )}

      {/* Toggle mensal / anual */}
      {isOwner && (
        <div className="animate-fade-up flex items-center justify-center gap-1 p-1 rounded-2xl self-start mx-auto w-fit"
          style={{ background: 'rgba(61,102,65,0.08)', border: '1px solid rgba(61,102,65,0.14)' }}>
          {(['month', 'year'] as BillingInterval[]).map(iv => (
            <button key={iv} onClick={() => setInterval(iv)}
              className="px-5 py-2 rounded-xl text-sm font-bold transition-all"
              style={{
                background: interval === iv ? '#14463A' : 'transparent',
                color: interval === iv ? 'white' : 'rgba(26,43,28,0.55)',
                border: 'none', cursor: 'pointer',
              }}>
              {iv === 'month' ? 'Mensal' : 'Anual'}
              {iv === 'year' && (
                <span className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background: interval === 'year' ? 'rgba(255,255,255,0.22)' : 'rgba(61,102,65,0.12)', color: interval === 'year' ? 'white' : '#3D6641' }}>
                  −20%
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Cards dos planos */}
      {isOwner && (
        <div className="animate-fade-up space-y-4">
          {PLANS.map(plan => {
            // "Plano atual" só quando plano E intervalo batem. Mesmo plano com
            // intervalo diferente (mensal↔anual) deve oferecer botão de troca.
            const isCurrentPlan = currentPlan === plan.id && isActive && billingInterval === interval
            // "Mudar para mensal/anual" é troca de ciclo — só faz sentido para quem
            // JÁ tem plano pago contratado (status active). Durante o trial o
            // billingInterval é null, então usar isActive faria null !== 'month'
            // disparar "Mudar para mensal" indevidamente. isPaidActive exclui trial.
            const samePlanDiffInterval = currentPlan === plan.id && isPaidActive && billingInterval !== interval
            const planPrices = prices[plan.id as keyof PlanPrices]
            const price = interval === 'year' ? planPrices.yearly : planPrices.monthly
            const Icon  = plan.icon

            return (
              <div key={plan.id}
                style={{
                  borderRadius: '17px 11px 15px 13px',
                  background: plan.highlight
                    ? `${NOISE}, linear-gradient(160deg,#FBF7F2,#F5EDE0)`
                    : `${NOISE}, linear-gradient(160deg,#FFFFFF,#FAFAF7)`,
                  backgroundSize: '200px 200px, 100% 100%',
                  border: plan.highlight
                    ? '1.5px solid rgba(196,154,108,0.40)'
                    : '1px solid rgba(61,102,65,0.18)',
                  boxShadow: plan.highlight
                    ? '0 6px 24px rgba(196,154,108,0.18)'
                    : '0 4px 16px rgba(44,74,46,0.08)',
                  padding: '20px 20px 18px',
                }}>

                {plan.highlight && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <Star size={12} color="#C49A6C" fill="#C49A6C" />
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#C49A6C', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Mais completo
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div style={{
                      width: 42, height: 42, borderRadius: 13, flexShrink: 0,
                      background: plan.iconBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={20} color={plan.iconColor} />
                    </div>
                    <div>
                      <p style={{ fontSize: 18, fontWeight: 700, color: '#1A2B1C', margin: 0 }}>{plan.name}</p>
                      <p style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)', margin: 0, lineHeight: 1.4 }}>
                        {plan.tagline}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 24, fontWeight: 800, color: '#1A2B1C', margin: 0, lineHeight: 1 }}>
                      R$ {fmtPrice(price)}
                    </p>
                    <p style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)', margin: '3px 0 0' }}>
                      /mês{interval === 'year' ? ' · cobrado anualmente' : ''}
                    </p>
                  </div>
                </div>

                {/* Features */}
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {plan.features.map(f => (
                    <li key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 6, flexShrink: 0,
                        background: plan.highlight ? 'rgba(196,154,108,0.18)' : 'rgba(61,102,65,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Check size={11} color={plan.highlight ? '#C49A6C' : '#3D6641'} strokeWidth={2.5} />
                      </div>
                      <span style={{
                        fontSize: 13,
                        color: f.bold ? '#1A2B1C' : 'rgba(26,43,28,0.60)',
                        fontWeight: f.bold ? 600 : 400,
                      }}>{f.text}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCurrentPlan ? (
                  <div className="flex items-center justify-center gap-2 py-3 rounded-[13px] text-sm font-bold"
                    style={{ background: 'rgba(61,102,65,0.08)', color: '#3D6641' }}>
                    <Check size={15} strokeWidth={2.5} />
                    {isTrialing ? (assinouNoTeste ? 'Assinado · cobra em ' + fmtDateShort(trialEndsAt) : 'Em teste agora') : 'Plano atual'}
                  </div>
                ) : (
                  <button onClick={() => handleCheckout(plan.id)}
                    disabled={!!loading}
                    className="w-full py-3 rounded-[13px] text-sm font-bold text-white transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)',
                      boxShadow: '0 4px 16px rgba(255,107,92,0.32)',
                      border: 'none', cursor: loading ? 'wait' : 'pointer',
                    }}>
                    {loading === plan.id
                      ? <><Loader2 size={15} className="animate-spin" /> Aguarde...</>
                      : samePlanDiffInterval
                        ? `Mudar para ${interval === 'year' ? 'anual' : 'mensal'}`
                        : isPaidActive
                          ? `Mudar para ${plan.name}`
                          : (isTrialing || trialDone)
                            ? `Assinar plano ${plan.name}`
                            : `Começar grátis por 14 dias`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Parceiro — herda o plano do owner, não gerencia assinatura */}
      {!isOwner && (
        <div className="animate-fade-up rounded-2xl p-4" style={{
          background: 'rgba(61,102,65,0.05)', border: '1px solid rgba(61,102,65,0.14)',
        }}>
          <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.65)', margin: 0, lineHeight: 1.5 }}>
            Você está usando como parceiro{ownerName ? ` de ${ownerName}` : ''}. O plano{' '}
            <strong>{PLAN_LABELS_UI[currentPlan]}</strong>{' '}
            {isFree
              ? 'é o ambiente compartilhado pelo responsável principal.'
              : 'é gerenciado pelo responsável principal — você tem acesso a todos os recursos do plano.'}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="animate-fade-up text-sm font-semibold px-4 py-3 rounded-2xl flex items-center gap-2"
          style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.20)' }}>
          {error}
        </div>
      )}

      {/* Notas de rodapé — só para o owner (parceiro não gerencia plano) */}
      {isOwner && (
        <>
          {/* Nota de segurança */}
          <p className="text-center text-xs animate-fade-up" style={{ color: 'rgba(26,43,28,0.35)' }}>
            Pagamento seguro via Stripe · Cancele quando quiser · Sem fidelidade
          </p>

          {/* Footnote acesso básico */}
          <p className="text-center text-xs animate-fade-up" style={{ color: 'rgba(26,43,28,0.30)', lineHeight: 1.6 }}>
            Após os 14 dias, você pode assinar ou continuar com acesso básico gratuito (até 2 filhos, IA limitada a 5 usos/mês, sem entrada por voz, sem resumo diário no WhatsApp e sem compartilhamento com parceiro). Seus dados nunca somem.
          </p>
        </>
      )}

      {/* Modal de cancelamento — captura o motivo */}
      <Modal open={cancelModalOpen} onClose={() => { if (loading !== 'cancel') setCancelModalOpen(false) }} title="Cancelar assinatura" size="sm">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'rgba(26,43,28,0.65)', lineHeight: 1.5 }}>
            {arrependimentoAte ? (
              <>
                <strong style={{ color: '#2C4A2E' }}>Você está no prazo de arrependimento.</strong>{' '}
                Cancelando agora, o valor pago é <strong>devolvido integralmente</strong> e a
                assinatura se encerra na hora — o estorno aparece na fatura do cartão em alguns
                dias, conforme o banco. O prazo vai até <strong>{fmtDate(arrependimentoAte)}</strong>.
              </>
            ) : (
              <>
                <strong>Nenhuma nova cobrança será feita.</strong> Você mantém o acesso completo
                até <strong>{fmtDate(currentPeriodEnd)}</strong>, que já está pago — e pode reativar
                a qualquer momento antes disso, sem precisar assinar de novo.
              </>
            )}
          </p>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'rgba(26,43,28,0.45)' }}>
              Conte por que está saindo <span style={{ fontWeight: 400, textTransform: 'none' }}>(opcional)</span>
            </p>
            <div className="space-y-1.5">
              {CANCEL_REASONS.map(r => (
                <label key={r.value}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                  style={{
                    background: cancelReason === r.value ? 'rgba(61,102,65,0.10)' : 'rgba(61,102,65,0.04)',
                    border: `1px solid ${cancelReason === r.value ? 'rgba(61,102,65,0.35)' : 'rgba(61,102,65,0.12)'}`,
                  }}>
                  <input type="radio" name="cancel-reason" value={r.value}
                    checked={cancelReason === r.value}
                    onChange={() => setCancelReason(r.value)}
                    style={{ accentColor: '#3D6641' }} />
                  <span className="text-sm" style={{ color: '#1A2B1C' }}>{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <textarea
              value={cancelComment}
              onChange={e => setCancelComment(e.target.value)}
              placeholder="Quer deixar um comentário? (opcional)"
              rows={3}
              maxLength={500}
              className="w-full px-3 py-2.5 rounded-xl text-sm resize-none"
              style={{ background: 'white', border: '1px solid rgba(61,102,65,0.18)', color: '#1A2B1C', outline: 'none' }}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => setCancelModalOpen(false)} disabled={loading === 'cancel'}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60"
              style={{ background: 'rgba(61,102,65,0.10)', color: '#2C4A2E', border: 'none', cursor: 'pointer' }}>
              Manter assinatura
            </button>
            <button onClick={handleCancel} disabled={loading === 'cancel'}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-105 disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626', border: 'none', cursor: 'pointer' }}>
              {loading === 'cancel' && <Loader2 size={14} className="animate-spin" />}
              Confirmar cancelamento
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
