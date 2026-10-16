// Server-only: envia o aviso de fim do teste (WhatsApp + e-mail) a UMA pessoa.
// Usado pela rotina diária (/api/cron/aviso-fim-teste) e pelo botão de teste
// do Painel do negócio (/api/admin/teste-aviso-fim) — o mesmo código, para o
// teste provar exatamente o que o cliente recebe.
import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarEmail } from '@/lib/email'
import { LEGAL_ENTITY } from '@/lib/legal'
import { resolveWhatsAppNumber, sendWhatsApp } from '@/lib/whatsapp'
import { REMETENTE_AVISO, assuntoEmail, avisoWhatsApp, emailEmHtml, emailEmTexto, paramsModeloFimTeste } from '@/lib/aviso-fim-teste'

export interface ResultadoAviso {
  whatsapp: boolean
  /** Qual modelo saiu: o de Marketing com botão, ou o de reserva sem botão. */
  modelo: 'fim_teste' | 'aviso_conta' | null
  email: boolean
  erros: string[]
}

export async function enviarAvisoFimTeste(admin: SupabaseClient, userId: string, fim: Date, kind = 'fim_teste'): Promise<ResultadoAviso> {
  const erros: string[] = []
  let whatsapp = false
  let modelo: ResultadoAviso['modelo'] = null

  const numero = await resolveWhatsAppNumber(admin, userId)
  if (!numero) erros.push('sem número de WhatsApp')
  else {
    // 1º: modelo de Marketing com o botão "Assinar o plano Família".
    const marketing = process.env.WHATSAPP_TEMPLATE_FIM_TESTE
    if (marketing) {
      const w = await sendWhatsApp(numero, paramsModeloFimTeste(fim), marketing, { userId, kind })
      if (w.ok) { whatsapp = true; modelo = 'fim_teste' }
      else erros.push('modelo fim_teste: ' + w.error)
    }
    // Reserva: aviso de conta, sem link nem preço.
    const reserva = process.env.WHATSAPP_TEMPLATE_ACCOUNT
    if (!whatsapp && reserva) {
      const w = await sendWhatsApp(numero, avisoWhatsApp(fim), reserva, { userId, kind })
      if (w.ok) { whatsapp = true; modelo = 'aviso_conta' }
      else erros.push('modelo aviso_conta: ' + w.error)
    }
    if (!marketing && !reserva) erros.push('nenhum modelo de WhatsApp configurado')
  }

  // E-mail: só para e-mail confirmado.
  let email = false
  const { data: u } = await admin.auth.admin.getUserById(userId)
  if (u.user?.email && u.user.email_confirmed_at) {
    const { data: perfil } = await admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle()
    const nome = (perfil?.full_name as string | null)?.trim().split(/\s+/)[0] || null
    const e = await enviarEmail(u.user.email, assuntoEmail(fim), emailEmHtml(nome, fim), emailEmTexto(nome, fim),
      { de: REMETENTE_AVISO, responderPara: LEGAL_ENTITY.email })
    email = e.ok
    if (!e.ok) erros.push('e-mail: ' + (e.naoConfigurado ? 'sem RESEND_API_KEY' : e.erro))
  } else erros.push('sem e-mail confirmado')

  return { whatsapp, modelo, email, erros }
}
