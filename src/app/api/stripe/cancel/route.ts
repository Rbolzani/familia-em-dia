import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { agendarFimDaAssinatura, reativarAssinatura } from '@/lib/stripe-arrependimento'
import { avisarCancelamento } from '@/lib/avisos-conta'

// Cancela (ou reativa) a assinatura vigente do usuário direto via API do Stripe.
// Não depende do portal externo — controle total dentro do app.
// Body: { reactivate?: boolean, reason, comment? }
//
// Regras desde a oferta de 20/10/2026 (Termos 5.4–5.6):
//  · cancelar NÃO devolve dinheiro: no teste nada foi cobrado; depois do teste
//    o acesso continua até o fim do período pago. O arrependimento de 7 dias
//    (CDC art. 49) transcorre dentro do teste grátis. (O reembolso automático
//    de 7 dias depois da cobrança, que existia antes, foi retirado.)
//  · o motivo é OBRIGATÓRIO (T12) e vai para cancellation_details no Stripe.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Valores aceitos pelo Stripe em cancellation_details.feedback.
  const VALID_FEEDBACK = [
    'customer_service', 'low_quality', 'missing_features', 'other',
    'switched_service', 'too_complex', 'too_expensive', 'unused',
  ] as const
  type Feedback = typeof VALID_FEEDBACK[number]

  let reactivate = false
  let feedback: Feedback | undefined
  let comment: string | undefined
  try {
    const body = await request.json().catch(() => ({}))
    reactivate = body?.reactivate === true
    if (typeof body?.reason === 'string' && VALID_FEEDBACK.includes(body.reason)) {
      feedback = body.reason as Feedback
    }
    if (typeof body?.comment === 'string' && body.comment.trim()) {
      comment = body.comment.trim().slice(0, 500)
    }
  } catch { /* corpo vazio = cancelar */ }

  if (!reactivate && !feedback) {
    return NextResponse.json({ error: 'Conte por que você está cancelando.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const customerId = row?.stripe_customer_id as string | null | undefined
  if (!customerId) {
    return NextResponse.json({ error: 'Nenhuma assinatura encontrada' }, { status: 404 })
  }

  try {
    // Busca a assinatura vigente (ativa, em teste ou com pagamento pendente).
    const listas = await Promise.all(['active', 'trialing', 'past_due'].map(st =>
      stripe.subscriptions.list({ customer: customerId, status: st as 'active', limit: 10 })))
    const liveSubs = listas.flatMap(l => l.data)

    if (liveSubs.length === 0) {
      return NextResponse.json({ error: 'Nenhuma assinatura ativa' }, { status: 404 })
    }

    // Agenda o fim (ou desfaz). Passa pelos helpers porque assinatura sob
    // `subscription_schedule` recusa alteração de cancelamento feita direto —
    // era o que derrubava este endpoint em 500, sem o botão fazer nada.
    for (const s of liveSubs) {
      if (reactivate) await reativarAssinatura(s)
      else await agendarFimDaAssinatura(s)
    }

    // O motivo é gravado à parte: `cancellation_details` é da assinatura, e
    // continua aceito mesmo quando o cancelamento em si passou pelo schedule.
    if (!reactivate && (feedback || comment)) {
      await Promise.all(liveSubs.map(s => stripe.subscriptions.update(s.id, {
        cancellation_details: {
          ...(feedback ? { feedback } : {}),
          ...(comment ? { comment } : {}),
        },
      }).catch(e => console.error('[stripe-cancel] motivo não gravado:', e))))
    }

    // Sincroniza o banco com o novo estado.
    await reconcileUserFromStripe(user.id)

    // Confirmação clara do cancelamento (E6 + WhatsApp) — só no modelo novo.
    if (!reactivate) await avisarCancelamento(user.id).catch(e => console.error('[stripe-cancel] confirmação:', e))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[stripe-cancel]', err)
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
