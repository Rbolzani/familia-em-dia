// Server-only: confirmação do e-mail SEM bloquear o acesso (decisão do Rogério,
// 21/10/2026). A conta do modelo novo nasce com o login liberado — a pessoa vai
// direto para o pagamento — e recebe este e-mail no cadastro. Enquanto não
// clicar, o app mostra a faixa "Confirme seu e-mail" (EmailConfirmBanner).
//
// Por que importa: é por e-mail que saem os avisos antes da cobrança (exigência
// das bandeiras) e a recuperação de senha. E-mail digitado errado = cliente
// cobrado sem ter sido avisado.
//
// Token de uso único em `email_confirmacoes` (só service_role); a marca fica em
// `profiles.email_confirmado_em` (NULL = pendente).

import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmail } from '@/lib/email'
import { LEGAL_ENTITY } from '@/lib/legal'

const SITE = 'https://www.familiaemdia.com.br'
const FONTE = '-apple-system,Segoe UI,sans-serif'

/** Gera um link novo (apaga os anteriores) e envia o e-mail. */
export async function enviarConfirmacaoEmail(userId: string, email: string, nome: string | null): Promise<boolean> {
  const admin = createAdminClient()
  const token = randomBytes(24).toString('base64url')
  await admin.from('email_confirmacoes').delete().eq('user_id', userId)
  const { error } = await admin.from('email_confirmacoes').insert({ token, user_id: userId })
  if (error) { console.error('[confirmacao-email] token:', error.code); return false }

  const link = `${SITE}/api/email/confirmar?t=${token}`
  const primeiro = nome?.trim().split(/\s+/)[0]
  const ola = primeiro ? `Olá, ${primeiro}!` : 'Olá!'
  const corpo = 'Falta só confirmar que este e-mail é seu. É por ele que enviamos os avisos da sua assinatura — inclusive os lembretes antes de qualquer cobrança — e o link para recuperar a senha.'
  const ignorar = 'Se você não criou uma conta no Família em Dia, ignore este e-mail.'
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8F3EA;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:22px 24px">
    <tr><td style="padding:0 0 14px;font:400 15px/1.6 ${FONTE};color:#1A2B1C">${ola}</td></tr>
    <tr><td style="padding:0 0 14px;font:400 15px/1.6 ${FONTE};color:#1A2B1C">${corpo}</td></tr>
    <tr><td style="padding:4px 0 22px"><a href="${link}" style="display:inline-block;background:#3D6641;color:#fff;text-decoration:none;font:700 14px ${FONTE};padding:12px 20px;border-radius:12px">Confirmar meu e-mail</a></td></tr>
    <tr><td style="padding:8px 0 0;border-top:1px solid #EFE8DA;font:400 12px/1.5 ${FONTE};color:#7A8577"><div style="padding-top:12px">${ignorar}</div></td></tr>
  </table></body></html>`
  const texto = [ola, corpo, `Confirmar meu e-mail: ${link}`, ignorar].join('\n\n')
  const r = await enviarEmail(email, 'Confirme seu e-mail no Família em Dia', html, texto, {
    de: `Família em Dia <${LEGAL_ENTITY.email}>`, responderPara: LEGAL_ENTITY.email,
  })
  if (!r.ok) console.error('[confirmacao-email] envio:', r.naoConfigurado ? 'sem RESEND_API_KEY' : r.erro)
  return r.ok
}

/** Consome o token. Devolve o user_id confirmado, ou null se o link não vale. */
export async function confirmarEmail(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const admin = createAdminClient()
  const { data } = await admin.from('email_confirmacoes').delete().eq('token', token).select('user_id').maybeSingle()
  const userId = (data?.user_id as string | undefined) ?? null
  if (!userId) return null
  await admin.from('profiles').update({ email_confirmado_em: new Date().toISOString() }).eq('user_id', userId)
  return userId
}
