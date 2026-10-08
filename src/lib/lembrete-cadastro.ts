// Server-only: o e-mail de "você ainda não começou a usar", enviado UMA vez a
// quem criou a conta e, um dia depois, ainda não cadastrou nenhum filho.
//
// Até 08/10/2026 este lembrete ia para quem parava no formulário "Complete seu
// cadastro". Aquela etapa deixou de existir (ver src/lib/cadastro.ts), então o
// alvo passou a ser quem entrou e não usou — sem filho cadastrado o app fica
// vazio: não há agenda, cofre nem resumo.
//
// É comunicação de serviço sobre a conta que a própria pessoa abriu — não é
// marketing, por isso não depende do opt-in de comunicações promocionais.
// ⚠️ Mudar aqui é mudar o que o cliente lê: o Rogério aprova o texto.

import { LEGAL_ENTITY } from '@/lib/legal'

/** Sai de suporte@ (e não de noreply@) porque o texto convida a responder. */
export const REMETENTE_LEMBRETE = `Família em Dia <${LEGAL_ENTITY.email}>`
export const ASSUNTO_LEMBRETE = 'Falta só cadastrar seu filho para começar no Família em Dia'

// Quem ainda nem concluiu o cadastro (conta antiga) é levado ao formulário
// curto pelo portão do app e, de lá, segue para o destino.
const LINK = 'https://www.familiaemdia.com.br/children'
const BOTAO = 'Cadastrar meu filho'

const PARAGRAFOS = [
  'Olá!',
  'Vi que você criou sua conta no Família em Dia, mas ainda não cadastrou nenhum filho. É o primeiro passo para usar o app, leva menos de dois minutos, e seu teste grátis de 14 dias já está valendo. Lembrando que para esse período grátis nenhum cartão de crédito é solicitado.',
]
const DEPOIS_DO_BOTAO = 'Se travou em alguma parte ou ficou com dúvida, é só responder este e-mail. Eu leio e respondo pessoalmente.'
const RODAPE = 'Você recebeu este e-mail porque criou uma conta em familiaemdia.com.br. Se não quiser mais receber, responda este e-mail avisando.'

export function lembreteEmTexto(): string {
  return [
    ...PARAGRAFOS,
    `${BOTAO}: ${LINK}`,
    DEPOIS_DO_BOTAO,
    'Obrigado,\nFamília em Dia',
    RODAPE,
  ].join('\n\n')
}

export function lembreteEmHtml(): string {
  const p = (t: string) =>
    `<tr><td style="padding:0 0 14px;font:400 15px/1.6 -apple-system,Segoe UI,sans-serif;color:#1A2B1C">${t}</td></tr>`
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8F3EA;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:22px 24px">
    ${PARAGRAFOS.map(p).join('\n    ')}
    <tr><td style="padding:4px 0 20px">
      <a href="${LINK}" style="display:inline-block;background:#3D6641;color:#fff;text-decoration:none;font:700 14px -apple-system,Segoe UI,sans-serif;padding:12px 20px;border-radius:12px">${BOTAO}</a>
    </td></tr>
    ${p(DEPOIS_DO_BOTAO)}
    ${p('Obrigado,<br>Família em Dia')}
    <tr><td style="padding:8px 0 0;border-top:1px solid #EFE8DA;font:400 12px/1.5 -apple-system,Segoe UI,sans-serif;color:#7A8577">
      <div style="padding-top:12px">${RODAPE}</div>
    </td></tr>
  </table></body></html>`
}
