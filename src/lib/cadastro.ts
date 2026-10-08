// Server-only: conclui o cadastro a partir do que a pessoa informou na tela de
// criar conta.
//
// POR QUE ASSIM
// Até 08/10/2026 havia uma segunda etapa ("Complete seu cadastro") com CPF,
// data de nascimento e endereço — 15 campos entre criar a conta e usar o app.
// Agora a conta grátis pede só nome, celular, "como conheceu" e o aceite dos
// Termos, tudo na tela de criar conta; CPF, nome completo e endereço ficaram
// para a hora de assinar (ver /api/stripe/checkout).
//
// No cadastro normal a pessoa ainda não tem sessão ao enviar o formulário (falta
// confirmar o e-mail), então esses dados viajam nos metadados do usuário e são
// gravados no perfil aqui, no primeiro acesso autenticado.

import type { User } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidPhoneBR, onlyDigits } from '@/lib/cpf'
import { LEGAL_VERSION } from '@/lib/legal'

/** Token do convite guardado pelo proxy no primeiro toque, se houver e for bem formado. */
export function conviteGuardado(valor: string | undefined): string | null {
  return valor && /^[0-9a-fA-F-]{36}$/.test(valor) ? valor : null
}

/**
 * Grava o perfil com os dados da criação da conta e carimba a conclusão.
 * Devolve false quando os metadados não bastam (conta criada antes desta
 * mudança, ou sem aceite dos Termos) — aí quem chama mostra o formulário curto.
 */
export async function concluirCadastroPelosMetadados(user: User): Promise<boolean> {
  const m = (user.user_metadata ?? {}) as Record<string, unknown>
  const nome = typeof m.full_name === 'string' ? m.full_name.trim() : ''
  const celular = onlyDigits(typeof m.phone === 'string' ? m.phone : '')
  // O aceite é uma declaração da própria pessoa; sem ele o cadastro não conclui.
  if (m.terms_accepted !== true || nome.length < 2 || !isValidPhoneBR(celular)) return false

  const origem = typeof m.acquisition_source === 'string' ? m.acquisition_source.trim().slice(0, 60) : ''
  const consentiu = m.marketing_consent === true
  const atribuicao = m.attribution && typeof m.attribution === 'object' ? m.attribution : null
  const agora = new Date().toISOString()

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').upsert({
    user_id: user.id,
    full_name: nome,
    phone: celular,
    acquisition_source: origem || null,
    signup_attribution: atribuicao,
    marketing_consent: consentiu,
    marketing_consent_at: consentiu ? user.created_at : null,
    // A caixa foi marcada ao criar a conta: essa é a data do aceite.
    terms_accepted_at: user.created_at,
    terms_version: typeof m.terms_version === 'string' ? m.terms_version : LEGAL_VERSION,
    profile_completed_at: agora,
    updated_at: agora,
  }, { onConflict: 'user_id' })

  if (error) {
    console.error('[cadastro] erro ao concluir pelos metadados', { code: error.code })
    return false
  }
  return true
}
