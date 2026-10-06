// Dados fiscais do assinante no Stripe: nome, CPF e endereço do cadastro vão
// para o Customer, para que cada pagamento já saia com o que a nota fiscal
// exige. O app continua sendo a fonte da verdade; o Stripe recebe uma cópia.

import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { formatCPF } from '@/lib/cpf'
import { ADDRESS_COLUMNS, addressError, addressFromRow, type Address } from '@/lib/address'

export interface DadosFiscais {
  nome: string | null
  cpf: string | null
  telefone: string | null
  endereco: Address | null   // null quando incompleto
}

export async function dadosFiscais(userId: string): Promise<DadosFiscais> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select(`full_name, cpf, phone, ${ADDRESS_COLUMNS}`)
    .eq('user_id', userId)
    .maybeSingle()

  const row = data as (Record<string, string | null> | null)
  const endereco = addressFromRow(row)
  return {
    nome: row?.full_name ?? null,
    cpf: row?.cpf ?? null,
    telefone: row?.phone ?? null,
    endereco: addressError(endereco) ? null : endereco,
  }
}

// Campos do Customer derivados do cadastro. Só inclui o que existe: um campo
// ausente não apaga o que já está no Stripe.
export function camposDoCliente(d: DadosFiscais): Stripe.CustomerUpdateParams {
  const campos: Stripe.CustomerUpdateParams = {}
  if (d.nome) campos.name = d.nome
  if (d.telefone) campos.phone = `+55${d.telefone}`
  if (d.endereco) {
    const e = d.endereco
    campos.address = {
      line1: `${e.street}, ${e.number}`,
      line2: [e.complement, e.district].filter(Boolean).join(' - '),
      city: e.city,
      state: e.state,
      postal_code: e.cep,
      country: 'BR',
    }
  }
  return campos
}

// Garante que o CPF está registrado como Tax ID do cliente. O CPF é imutável
// no app, então basta criar uma vez.
async function garantirCpf(customerId: string, cpf: string) {
  const existentes = await stripe.customers.listTaxIds(customerId, { limit: 10 })
  if (existentes.data.some(t => t.type === 'br_cpf')) return
  await stripe.customers.createTaxId(customerId, { type: 'br_cpf', value: formatCPF(cpf) })
}

// Copia os dados fiscais do cadastro para o Customer. Nunca derruba quem
// chamou: uma falha aqui não pode impedir uma assinatura nem um salvamento de
// perfil. Loga só o código — a mensagem do Stripe pode trazer o CPF.
export async function sincronizarClienteStripe(customerId: string, userId: string, dados?: DadosFiscais) {
  try {
    const d = dados ?? await dadosFiscais(userId)
    const campos = camposDoCliente(d)
    if (Object.keys(campos).length > 0) await stripe.customers.update(customerId, campos)
    if (d.cpf) await garantirCpf(customerId, d.cpf)
  } catch (err) {
    const e = err as { code?: string; type?: string }
    console.error('[stripe-customer] falha ao sincronizar dados fiscais', { code: e?.code, type: e?.type })
  }
}
