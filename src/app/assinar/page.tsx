import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import AssinarClient, { type Modo } from './AssinarClient'
import type { PlanoPago, Ciclo } from '@/lib/planos-oferta'

// "Conclua sua assinatura" — modelo novo (teste com cartão).
//   · conta criada sem cartão (incompleto)  → T7: escolhe o plano e segue para o Stripe
//   · cartão que já usou o teste (?cartao=usado) → T5: assinar sem teste ou voltar
//   · conta pausada                          → reativar (sem teste; cobra hoje)
//   · família herdada (o dono excluiu a conta) → herdou (mesma regra da pausada)
// Fica FORA do grupo (app): o layout de lá manda quem está "incompleto" para
// cá, e esta página não pode cair no mesmo desvio.
export const metadata = { title: 'Conclua sua assinatura · Família em Dia' }

export default async function AssinarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/assinar')

  const { data: sub } = await createAdminClient()
    .from('subscriptions')
    .select('plan, billing_interval, status, oferta, pause_reason')
    .eq('user_id', user.id)
    .maybeSingle()
  if (sub?.oferta !== 'v2') redirect('/planos')
  if (sub.status !== 'incompleto' && sub.status !== 'paused') redirect('/dashboard')

  const q = await searchParams
  const modo: Modo = sub.status === 'paused' ? (sub.pause_reason === 'dono_saiu' ? 'herdou' : 'reativar') : q.cartao === 'usado' ? 'cartao_usado' : 'concluir'
  const plano = (['basico', 'familia', 'plus'].includes(sub.plan as string) ? sub.plan : 'familia') as PlanoPago
  const ciclo: Ciclo = sub.billing_interval === 'year' ? 'year' : 'month'

  return <AssinarClient modo={modo} planoInicial={plano} cicloInicial={ciclo} voltouDoStripe={q.billing === 'cancelado'} />
}
