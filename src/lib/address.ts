// Endereço do responsável — exigido para a nota fiscal de quem assina.
// Fonte única de formato e validação: formulários, /api/profile e o envio ao
// Stripe consomem daqui.

import { onlyDigits } from '@/lib/cpf'

export interface Address {
  cep: string         // 8 dígitos, sem máscara
  street: string
  number: string      // texto: aceita "s/n", "123A"
  complement: string  // opcional
  district: string
  city: string
  state: string       // UF, 2 letras maiúsculas
}

export const EMPTY_ADDRESS: Address = {
  cep: '', street: '', number: '', complement: '', district: '', city: '', state: '',
}

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

export function formatCEP(value: string): string {
  const d = onlyDigits(value).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

// Normaliza o que veio do cliente: apara, limita tamanho e padroniza CEP/UF.
export function normalizeAddress(raw: Partial<Record<keyof Address, unknown>> | null | undefined): Address {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  return {
    cep: onlyDigits(s(raw?.cep, 12)).slice(0, 8),
    street: s(raw?.street, 120),
    number: s(raw?.number, 12),
    complement: s(raw?.complement, 60),
    district: s(raw?.district, 80),
    city: s(raw?.city, 80),
    state: s(raw?.state, 2).toUpperCase(),
  }
}

// Devolve a mensagem do primeiro problema, ou null se o endereço está completo.
export function addressError(a: Address): string | null {
  if (a.cep.length !== 8) return 'CEP inválido.'
  if (a.street.length < 2) return 'Informe a rua.'
  if (!a.number) return 'Informe o número (ou "s/n").'
  if (a.district.length < 2) return 'Informe o bairro.'
  if (a.city.length < 2) return 'Informe a cidade.'
  if (!(UFS as readonly string[]).includes(a.state)) return 'Selecione o estado.'
  return null
}

// Colunas de `profiles` ↔ Address.
export const ADDRESS_COLUMNS =
  'address_cep, address_street, address_number, address_complement, address_district, address_city, address_state'

type AddressRow = {
  address_cep?: string | null; address_street?: string | null; address_number?: string | null
  address_complement?: string | null; address_district?: string | null
  address_city?: string | null; address_state?: string | null
}

export function addressFromRow(row: AddressRow | null | undefined): Address {
  return {
    cep: row?.address_cep ?? '',
    street: row?.address_street ?? '',
    number: row?.address_number ?? '',
    complement: row?.address_complement ?? '',
    district: row?.address_district ?? '',
    city: row?.address_city ?? '',
    state: row?.address_state ?? '',
  }
}

export function addressToRow(a: Address) {
  return {
    address_cep: a.cep,
    address_street: a.street,
    address_number: a.number,
    address_complement: a.complement || null,
    address_district: a.district,
    address_city: a.city,
    address_state: a.state,
  }
}
