import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { janelaArrependimento, reembolsarEEncerrar } from '@/lib/stripe-arrependimento'

// Cancela (ou reativa) a assinatura vigente do usuário direto via API do Stripe.
// Não depende do portal externo — controle total dentro do app.
// Body: { reactivate?: boolean }
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
    // Busca a assinatura vigente (ativa ou em trial) do cliente.
    const [activeList, trialingList] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 }),
      stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 10 }),
    ])
    const liveSubs = [...activeList.data, ...trialingList.data]

    if (liveSubs.length === 0) {
      return NextResponse.json({ error: 'Nenhuma assinatura ativa' }, { status: 404 })
    }

    // ── Direito de arrependimento (CDC art. 49) ──────────────────────────
    // Dentro de 7 dias da cobrança, cancelar NÃO é "encerrar no fim do
    // período": é desfazer a compra. Dinheiro de volta, acesso encerrado na
    // hora. Fora da janela, segue o comportamento normal.
    if (!reactivate) {
      const janela = await janelaArrependimento(customerId)
      if (janela.dentro) {
        const { reembolsado } = await reembolsarEEncerrar(janela, liveSubs)
        // Registra o motivo mesmo no arrependimento — é a informação mais
        // valiosa que existe sobre quem desiste nos primeiros dias.
        if (feedback || comment) {
          await Promise.all(liveSubs.map(s => stripe.subscriptions.update(s.id, {
            cancellation_details: {
              ...(feedback ? { feedback } : {}),
              ...(comment ? { comment } : {}),
            },
          }).catch(e => console.error('[stripe-cancel] motivo não gravado:', e))))
        }
        await reconcileUserFromStripe(user.id)
        console.warn('[stripe-cancel] arrependimento: R$ %s devolvidos a %s',
          (reembolsado / 100).toFixed(2), user.id)
        return NextResponse.json({ ok: true, reembolsado })
      }
    }

    // Monta o payload — inclui o motivo do cancelamento quando aplicável.
    const updateParams: Parameters<typeof stripe.subscriptions.update>[1] = {
      cancel_at_period_end: !reactivate,
    }
    if (!reactivate && (feedback || comment)) {
      updateParams.cancellation_details = {
        ...(feedback ? { feedback } : {}),
        ...(comment ? { comment } : {}),
      }
    }

    // Aplica a operação em todas as vigentes (normalmente só há uma).
    await Promise.all(
      liveSubs.map(s => stripe.subscriptions.update(s.id, updateParams))
    )

    // Sincroniza o banco com o novo estado.
    await reconcileUserFromStripe(user.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[stripe-cancel]', err)
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
