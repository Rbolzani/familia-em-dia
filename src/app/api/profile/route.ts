import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isValidCPF, isValidPhoneBR, onlyDigits } from '@/lib/cpf'
import { LEGAL_VERSION } from '@/lib/legal'
import { addressError, addressToRow, normalizeAddress, type Address } from '@/lib/address'
import { sincronizarClienteStripe } from '@/lib/stripe-customer'

// Salva o cadastro inicial de dados pessoais (LGPD / cobrança) e marca
// profile_completed_at. Validação no servidor — o cliente é só conveniência.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    full_name?: string; phone?: string; cpf?: string; birth_date?: string
    marketing_consent?: boolean; acquisition_source?: string
    attribution?: Record<string, unknown>; terms_accepted?: boolean
    address?: Partial<Record<keyof Address, unknown>>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }

  const full_name = (body.full_name ?? '').trim()
  const phone     = onlyDigits(body.phone ?? '')
  const birthDate = (body.birth_date ?? '').trim() || null

  if (full_name.length < 3)        return NextResponse.json({ error: 'Informe seu nome completo.' }, { status: 400 })
  if (!isValidPhoneBR(phone))      return NextResponse.json({ error: 'Celular inválido. Use DDD + número.' }, { status: 400 })
  if (!birthDate)                  return NextResponse.json({ error: 'Informe sua data de nascimento.' }, { status: 400 })

  // Não permite data de nascimento no futuro.
  if (new Date(birthDate) > new Date()) {
    return NextResponse.json({ error: 'Data de nascimento inválida.' }, { status: 400 })
  }

  // Endereço: exigido de quem assina (nota fiscal), não de parceiro convidado —
  // por isso é opcional aqui e cobrado no checkout. Se veio, tem que vir inteiro.
  let addressRow: ReturnType<typeof addressToRow> | null = null
  if (body.address) {
    const address = normalizeAddress(body.address)
    const problema = addressError(address)
    if (problema) return NextResponse.json({ error: problema }, { status: 400 })
    addressRow = addressToRow(address)
  }

  // CPF é imutável após o primeiro cadastro (identidade fiscal). Server-side:
  // se já houver CPF salvo, ignora o do cliente; senão, valida e grava o novo.
  const { data: existing } = await supabase
    .from('profiles')
    .select('cpf, profile_completed_at, marketing_consent, marketing_consent_at, acquisition_source, signup_attribution, terms_accepted_at, terms_version')
    .eq('user_id', user.id)
    .maybeSingle()

  // Aceite dos Termos/Privacidade: obrigatório na primeira conclusão do cadastro.
  // Em edições posteriores (já aceito), preserva o aceite original.
  const alreadyAccepted = !!existing?.terms_accepted_at
  if (!alreadyAccepted && body.terms_accepted !== true) {
    return NextResponse.json(
      { error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade.' },
      { status: 400 },
    )
  }
  const termsAcceptedAt = existing?.terms_accepted_at ?? new Date().toISOString()
  const termsVersion = existing?.terms_version ?? LEGAL_VERSION

  let cpf = existing?.cpf as string | null | undefined
  if (!cpf) {
    cpf = onlyDigits(body.cpf ?? '')
    if (!isValidCPF(cpf)) return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 })
  }

  // Consentimento de marketing (LGPD): editável a qualquer momento. Registra o
  // timestamp na transição para "concedido"; mantém o original se já concedido.
  const consent = body.marketing_consent === true
  const now = new Date().toISOString()
  const consentAt = consent
    ? (existing?.marketing_consent ? existing.marketing_consent_at : now)
    : null

  // "Como conheceu" e atribuição (UTM/referrer) são set-once: não sobrescreve.
  const acquisitionSource = existing?.acquisition_source ?? (body.acquisition_source?.trim() || null)
  const attribution = existing?.signup_attribution ?? (body.attribution ?? null)

  // RLS (profiles_upsert_own) garante que o usuário só grava o próprio perfil.
  const { error } = await supabase.from('profiles').upsert({
    user_id: user.id,
    full_name,
    phone,
    cpf,
    birth_date: birthDate,
    ...(addressRow ?? {}),
    marketing_consent: consent,
    marketing_consent_at: consentAt,
    acquisition_source: acquisitionSource,
    signup_attribution: attribution,
    terms_accepted_at: termsAcceptedAt,
    terms_version: termsVersion,
    // Carimba a conclusão só na primeira vez; edições preservam o original.
    profile_completed_at: existing?.profile_completed_at ?? now,
    updated_at: now,
  }, { onConflict: 'user_id' })

  if (error) {
    // Índice único de CPF
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Este CPF já está cadastrado em outra conta.' }, { status: 409 })
    }
    // Só o código, nunca o erro inteiro: esta rota grava CPF, e uma violação
    // de unicidade no PostgREST traz o VALOR do campo na mensagem. O Sentry
    // transforma console.* em breadcrumb — o CPF sairia do país junto.
    console.error('[profile] erro ao salvar', { code: error.code })
    // A mensagem do PostgREST descreve o schema; fica no log, não na resposta.
    return NextResponse.json({ error: 'Não foi possível salvar seus dados.' }, { status: 500 })
  }

  // Quem já é cliente no Stripe tem o nome/endereço atualizados lá também,
  // para a próxima nota sair com o dado novo.
  const { data: sub } = await createAdminClient()
    .from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
  const customerId = sub?.stripe_customer_id as string | null | undefined
  if (customerId) await sincronizarClienteStripe(customerId, user.id)

  return NextResponse.json({ ok: true })
}
