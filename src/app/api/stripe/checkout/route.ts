import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { stripe, planToPrice, ehPrecoLancamento, type PlanId, type BillingInterval } from '@/lib/stripe'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { reservarVaga, precoLancamentoId, CHECKOUT_LANCAMENTO_SEGUNDOS } from '@/lib/oferta-lancamento'
import { dadosFiscais, camposDoCliente, sincronizarClienteStripe } from '@/lib/stripe-customer'

export async function POST(request: Request) {
  // 1. Sessão
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Corpo: plano + intervalo (a elegibilidade de trial é decidida no servidor,
  // nunca pelo cliente — ver passo 5).
  let plan: PlanId
  let interval: BillingInterval
  try {
    const body = await request.json()
    plan      = body.plan
    interval  = body.interval
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }

  if ((plan !== 'familia' && plan !== 'plus') || (interval !== 'month' && interval !== 'year')) {
    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
  }

  const priceId = planToPrice(plan, interval)
  if (!priceId) {
    return NextResponse.json({ error: 'Preço não configurado' }, { status: 500 })
  }

  const admin = createAdminClient()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin

  try {
    // 3. Buscar/garantir o Stripe customer do usuário
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, status, trial_ends_at, plan')
      .eq('user_id', user.id)
      .maybeSingle()

    let customerId = sub?.stripe_customer_id as string | null | undefined

    // Conta cortesia: plano pago gravado no banco, sem cliente no Stripe.
    // Assinar por aqui cobraria de verdade quem já tem acesso completo.
    if (!customerId && sub?.status === 'active' && sub?.plan && sub.plan !== 'free') {
      return NextResponse.json(
        { error: 'Esta conta tem plano cortesia e não precisa de assinatura.', code: 'cortesia' },
        { status: 400 },
      )
    }

    // A nota fiscal sai com nome, CPF e endereço do cadastro. Nome e CPF são
    // obrigatórios para entrar no app; o endereço pode faltar (conta antiga ou
    // parceiro convidado que virou assinante) — sem ele não há como faturar.
    const fiscais = await dadosFiscais(user.id)
    if (!fiscais.endereco) {
      return NextResponse.json(
        { error: 'Antes de assinar, complete seu endereço em Minha Conta. Ele é usado na nota fiscal.', code: 'endereco_pendente' },
        { status: 400 },
      )
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        ...(camposDoCliente(fiscais) as Stripe.CustomerCreateParams),
        metadata: { user_id: user.id },
      })
      customerId = customer.id

      await admin
        .from('subscriptions')
        .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' })
    }

    // Mantém o Customer em dia com o cadastro (e registra o CPF como Tax ID).
    await sincronizarClienteStripe(customerId, user.id, fiscais)

    // 4. Decidir entre: trocar de plano/intervalo, reativar, ou criar checkout novo.
    if (customerId) {
      const [activeList, trialingList] = await Promise.all([
        stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 }),
        stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 10 }),
      ])
      const liveSubs = [...activeList.data, ...trialingList.data]
      const current = liveSubs.find(s => !s.cancel_at_period_end) ?? liveSubs.find(s => s.cancel_at_period_end)

      if (current) {
        const currentItem = current.items.data[0]
        const currentPriceId = currentItem?.price?.id
        // Quem tem preço de lançamento leva o desconto para qualquer plano:
        // a troca vai para o preço de lançamento do plano novo.
        const alvoId = ehPrecoLancamento(currentItem?.price)
          ? (await precoLancamentoId(plan, interval)) ?? priceId
          : priceId

        // 4a. Mesmo plano/intervalo → nada a trocar.
        if (currentPriceId === alvoId && !current.cancel_at_period_end) {
          return NextResponse.json({ url: `${baseUrl}/planos` })
        }

        // 4b. Plano ou intervalo diferente → modifica a assinatura existente.
        // A própria sub já tem o método de pagamento, então NÃO pede cartão.
        // Trocar o item de preço por um de intervalo diferente faz a sub adotar
        // o novo intervalo; billing_cycle_anchor:'now' inicia o ciclo já e cobra
        // a diferença proporcional. Reconcilia do Stripe para refletir no banco.
        if (currentPriceId !== alvoId) {
          const hasPm = !!current.default_payment_method
          if (hasPm) {
            await stripe.subscriptions.update(current.id, {
              items: [{ id: currentItem.id, price: alvoId }],
              proration_behavior: 'create_prorations',
              billing_cycle_anchor: 'now',
              cancel_at_period_end: false,
              metadata: { user_id: user.id, plan },
            })
            await reconcileUserFromStripe(user.id)
            return NextResponse.json({ url: `${baseUrl}/planos?billing=plano-alterado` })
          }
          // Sem método de pagamento na sub (ex: só teve trial, nunca pagou) →
          // vai para o checkout normal (passo 5), que coleta o cartão.
        }

        // 4c. Mesmo preço mas estava cancelando → reativar.
        if (currentPriceId === alvoId && current.cancel_at_period_end) {
          await stripe.subscriptions.update(current.id, { cancel_at_period_end: false })
          return NextResponse.json({ url: `${baseUrl}/planos?billing=reativado` })
        }
      }
    }

    // 5. Sessão de checkout — modo assinatura.
    // Elegibilidade de trial é decidida AQUI, no servidor, a partir do banco.
    // Regra: o trial só preserva o fim do trial ORIGINAL do cadastro
    // (status='trialing' com trial_ends_at no futuro). Nunca concede um trial
    // novo — quem já passou pelos 14 dias é cobrado imediatamente, sem exceção.
    let trialEnd: number | undefined
    if (sub?.status === 'trialing' && sub.trial_ends_at) {
      const endsMs = new Date(sub.trial_ends_at).getTime()
      if (endsMs > Date.now() + 48 * 60 * 60 * 1000) {
        trialEnd = Math.floor(endsMs / 1000)
      }
    }

    // Oferta de lançamento: reserva uma das 20 vagas antes de abrir o
    // pagamento. A reserva dura um pouco mais que a sessão (que expira em 31
    // min); checkout abandonado devolve a vaga sozinho. Se a vaga não sair
    // (esgotou, ou o banco falhou), segue no preço regular — nunca trava a
    // assinatura. Código promocional fica desligado na oferta para não
    // empilhar desconto sobre desconto.
    let linhaPreco = priceId
    let comOferta = false
    const vaga = await reservarVaga(user.id)
    if (vaga === 'reservada' || vaga === 'confirmada') {
      const lancamento = await precoLancamentoId(plan, interval)
      if (lancamento) { linhaPreco = lancamento; comOferta = true }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: linhaPreco, quantity: 1 }],
      subscription_data: {
        ...(trialEnd ? { trial_end: trialEnd } : {}),
        metadata: { user_id: user.id, plan, ...(comOferta ? { oferta: 'lancamento' } : {}) },
      },
      ...(comOferta
        ? { expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_LANCAMENTO_SEGUNDOS }
        : { allow_promotion_codes: true }),
      // Passa por /api/stripe/return: ele reconcilia o plano com o Stripe
      // (protege contra webhook atrasado) e entrega o Início. Antes vinha
      // direto para /configuracoes — que reconcilia, mas deixava a pessoa em
      // "Compartilhar acesso" logo após assinar.
      success_url: `${baseUrl}/api/stripe/return`,
      cancel_url: `${baseUrl}/planos?billing=cancelado`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[stripe-checkout]', err)
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
