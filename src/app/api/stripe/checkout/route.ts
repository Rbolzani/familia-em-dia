import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { stripe, precoVigenteId, type PlanoPagoId, type BillingInterval } from '@/lib/stripe'
import { reconcileUserFromStripe } from '@/lib/stripe-sync'
import { dadosFiscais, camposDoCliente, sincronizarClienteStripe, nomeCompleto } from '@/lib/stripe-customer'
import { ajustesParaPlano, textoAjustes } from '@/lib/oferta-v2'
import { DIAS_TESTE } from '@/lib/planos-oferta'

// Assinar, trocar de plano/ciclo e reativar — modelo antigo (v1) e novo (v2).
//
// Modelo novo (cadastro com cartão, aprovado em 20/10/2026):
//  · conta "incompleto" → Checkout com 14 dias grátis e cartão obrigatório.
//    Hoje R$ 0,00; a primeira cobrança é automática no 15º dia.
//  · `semTeste: true` → Checkout sem teste (cartão que já usou o teste, T5).
//  · conta "pausada" → reativar = Checkout sem teste (o teste vale uma vez).
//  · troca de plano EM TESTE → vale na hora, sem cobrança; o teste continua até
//    a mesma data e a primeira cobrança sai no valor do plano novo.
// Modelo antigo: igual a antes (o teste é do app; o Checkout só preserva a data).

export async function POST(request: Request) {
  // 1. Sessão
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Corpo
  let plan: PlanoPagoId
  let interval: BillingInterval
  let semTeste = false
  // De onde veio (tela Planos, botão do WhatsApp ou do e-mail). Vai para a
  // metadata da assinatura e aparece no Painel do negócio.
  let origem: 'app' | 'whatsapp' | 'email' = 'app'
  try {
    const body = await request.json()
    plan      = body.plan
    interval  = body.interval
    semTeste  = body.semTeste === true
    if (body.origem === 'whatsapp' || body.origem === 'email') origem = body.origem
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }
  if ((plan !== 'basico' && plan !== 'familia' && plan !== 'plus') || (interval !== 'month' && interval !== 'year')) {
    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
  }

  const priceId = await precoVigenteId(plan, interval).catch(e => { console.error('[stripe-checkout] preço vigente:', e); return null })
  if (!priceId) return NextResponse.json({ error: 'Preço não configurado' }, { status: 500 })

  const admin = createAdminClient()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin

  try {
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, status, trial_ends_at, plan, oferta')
      .eq('user_id', user.id)
      .maybeSingle()
    const v2 = sub?.oferta === 'v2'
    let customerId = sub?.stripe_customer_id as string | null | undefined

    // Conta cortesia: plano pago gravado no banco, sem cliente no Stripe.
    // Assinar por aqui cobraria de verdade quem já tem acesso completo.
    if (!customerId && sub?.status === 'active' && sub?.plan && sub.plan !== 'free') {
      return NextResponse.json(
        { error: 'Esta conta tem plano cortesia e não precisa de assinatura.', code: 'cortesia' },
        { status: 400 },
      )
    }

    // Dados da nota fiscal. No modelo novo o CPF vem do cadastro e o endereço
    // é pedido pela própria tela do Stripe (decisão 20/10/2026); no antigo,
    // os três são cobrados aqui e a tela de planos abre "Dados para a assinatura".
    const fiscais = await dadosFiscais(user.id)
    if (!nomeCompleto(fiscais.nome) || !fiscais.cpf || (!v2 && !fiscais.endereco)) {
      return NextResponse.json(
        { error: 'Antes de assinar, informe nome completo, CPF e endereço. Eles são usados na nota fiscal.', code: 'dados_pendentes' },
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

    // 3. Já tem assinatura viva? → trocar de plano/ciclo ou reativar.
    const listas = await Promise.all(['active', 'trialing', 'past_due'].map(st =>
      stripe.subscriptions.list({ customer: customerId!, status: st as Stripe.SubscriptionListParams.Status, limit: 10 })))
    const liveSubs = listas.flatMap(l => l.data)
    const current = liveSubs.find(s => !s.cancel_at_period_end) ?? liveSubs.find(s => s.cancel_at_period_end)

    if (current) {
      const currentItem = current.items.data[0]
      const currentPriceId = currentItem?.price?.id

      // 3a. Mesmo plano/intervalo e não cancelando → nada a trocar.
      if (currentPriceId === priceId && !current.cancel_at_period_end) {
        return NextResponse.json({ url: `${baseUrl}/planos` })
      }

      if (currentPriceId !== priceId) {
        // Plano menor com filhos/rede acima do limite: a pessoa ajusta antes (T14).
        const ajustes = await ajustesParaPlano(user.id, plan)
        if (ajustes) {
          return NextResponse.json({ error: 'Ajuste a conta antes de mudar de plano.', code: 'ajustar_conta', itens: textoAjustes(plan, ajustes) }, { status: 409 })
        }
        const hasPm = !!current.default_payment_method
        if (current.status === 'trialing') {
          // 3b. Em teste: troca na hora, sem cobrança, mantendo a data do teste.
          await stripe.subscriptions.update(current.id, {
            items: [{ id: currentItem.id, price: priceId }],
            proration_behavior: 'none',
            cancel_at_period_end: false,
            metadata: { ...current.metadata, user_id: user.id, plan },
          })
          await reconcileUserFromStripe(user.id)
          return NextResponse.json({ url: `${baseUrl}/planos?billing=plano-alterado` })
        }
        if (hasPm) {
          // 3c. Pagando: troca com proração; billing_cycle_anchor:'now' inicia o
          // ciclo já e cobra a diferença proporcional, sem pedir cartão.
          await stripe.subscriptions.update(current.id, {
            items: [{ id: currentItem.id, price: priceId }],
            proration_behavior: 'create_prorations',
            billing_cycle_anchor: 'now',
            cancel_at_period_end: false,
            metadata: { ...current.metadata, user_id: user.id, plan },
          })
          await reconcileUserFromStripe(user.id)
          return NextResponse.json({ url: `${baseUrl}/planos?billing=plano-alterado` })
        }
        // Sem método de pagamento na sub (modelo antigo, só teve trial) →
        // segue para o Checkout, que coleta o cartão.
      }

      // 3d. Mesmo preço mas estava cancelando → reativar.
      if (currentPriceId === priceId && current.cancel_at_period_end) {
        await stripe.subscriptions.update(current.id, { cancel_at_period_end: false })
        await reconcileUserFromStripe(user.id)
        return NextResponse.json({ url: `${baseUrl}/planos?billing=reativado` })
      }
    }

    // 4. Sessão de Checkout nova.
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: { user_id: user.id, plan, origem, oferta: v2 ? 'v2' : 'v1' },
    }
    if (v2) {
      // Teste de 14 dias só para quem ainda não teve (conta "incompleto").
      // Conta pausada reativa sem teste; T5 (cartão já usado) também.
      if (sub?.status === 'incompleto' && !semTeste) {
        subscriptionData.trial_period_days = DIAS_TESTE
        // Se o teste terminar sem cartão válido, a assinatura cancela sozinha.
        subscriptionData.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } }
      }
      // Guarda a escolha (a tela /assinar e os avisos mostram plano e ciclo).
      if (sub?.status === 'incompleto') {
        await admin.from('subscriptions').update({ plan, billing_interval: interval }).eq('user_id', user.id)
      }
    } else {
      // Modelo antigo: o teste é do app. O Checkout só preserva o fim do teste
      // original (nunca concede um novo).
      if (sub?.status === 'trialing' && sub.trial_ends_at) {
        const endsMs = new Date(sub.trial_ends_at).getTime()
        if (endsMs > Date.now() + 48 * 60 * 60 * 1000) subscriptionData.trial_end = Math.floor(endsMs / 1000)
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      metadata: { user_id: user.id, plan, interval, origem },
      allow_promotion_codes: true,
      locale: 'pt-BR',
      ...(v2 ? {
        payment_method_collection: 'always' as const,
        billing_address_collection: 'required' as const,
        customer_update: { address: 'auto' as const, name: 'auto' as const },
      } : {}),
      // /api/stripe/return reconcilia com o Stripe (protege contra webhook
      // atrasado), confere o cartão do teste e entrega o Início.
      success_url: `${baseUrl}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: v2 && sub?.status !== 'trialing' && sub?.status !== 'active'
        ? `${baseUrl}/assinar?billing=cancelado`
        : `${baseUrl}/planos?billing=cancelado`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[stripe-checkout]', err)
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
