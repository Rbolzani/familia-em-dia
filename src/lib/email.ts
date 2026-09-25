// Server-only: envio de e-mail transacional via Resend.
//
// POR QUE EXISTE
// O resumo diário dependia de UM canal só. Em set/2026 a conta do WhatsApp
// Business ficou com US$ 1,01 em atraso, a Meta parou de ENTREGAR (aceitando
// as mensagens normalmente) e o resumo sumiu por duas semanas — sem que o
// pagamento pudesse ser feito, porque o perfil de cobrança da Meta recusava
// tanto a cobrança quanto o cadastro de outro cartão. Um canal único é um
// ponto único de falha, e este foi o custo de descobrir isso.
//
// ⚠️ A chave é a MESMA do Resend que o Supabase usa no SMTP de auth, mas
// precisa existir também como env var da Vercel (`RESEND_API_KEY`) — o
// Next não enxerga o que está configurado dentro do Supabase.
//
// Sem a chave, `enviarEmail` devolve `naoConfigurado` e quem chama segue a
// vida: é degradação, não erro.

const RESEND_URL = 'https://api.resend.com/emails'

/** Remetente já verificado no Resend (SPF/DKIM/DMARC no Registro.br). */
const REMETENTE = 'Família em Dia <noreply@familiaemdia.com.br>'

export type ResultadoEmail =
  | { ok: true; id: string | null }
  | { ok: false; naoConfigurado: true }
  | { ok: false; naoConfigurado?: false; erro: string }

export async function enviarEmail(
  para: string,
  assunto: string,
  html: string,
  texto: string,
): Promise<ResultadoEmail> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, naoConfigurado: true }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      // `text` junto do `html` não é capricho: melhora a entrega e é o que
      // aparece na pré-visualização de vários clientes de e-mail.
      body: JSON.stringify({ from: REMETENTE, to: [para], subject: assunto, html, text: texto }),
    })
    const corpo = await res.text()
    if (!res.ok) return { ok: false, erro: `Resend HTTP ${res.status}: ${corpo.slice(0, 300)}` }
    const id = (JSON.parse(corpo) as { id?: string }).id ?? null
    return { ok: true, id }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'falha desconhecida' }
  }
}

// ── Resumo diário em HTML ────────────────────────────────────────────────────
// O texto corrido (`summary.full`) já vem pronto de `buildDailySummary`, com
// as seções separadas por linha em branco e o título de cada uma na primeira
// linha do bloco. Aqui ele só ganha forma; nenhuma regra de conteúdo mora
// neste arquivo, para não haver duas verdades sobre o que entra no resumo.
function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function resumoEmHtml(full: string, linkApp: string): string {
  const blocos = full.split('\n\n').filter(Boolean)
  const [cabecalho, ...secoes] = blocos

  const corpo = secoes.map(bloco => {
    const [titulo, ...linhas] = bloco.split('\n')
    return `
      <tr><td style="padding:14px 0 0">
        <div style="font:700 13px/1.4 -apple-system,Segoe UI,sans-serif;color:#3D6641">${escapar(titulo)}</div>
        <div style="font:400 15px/1.6 -apple-system,Segoe UI,sans-serif;color:#1A2B1C;margin-top:4px">${escapar(linhas.join(' · '))}</div>
      </td></tr>`
  }).join('')

  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8F3EA;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:22px 24px">
    <tr><td style="font:700 19px/1.3 Georgia,serif;color:#1A2B1C">${escapar(cabecalho ?? 'Resumo da Família')}</td></tr>
    ${corpo}
    <tr><td style="padding:22px 0 0">
      <a href="${linkApp}" style="display:inline-block;background:#3D6641;color:#fff;text-decoration:none;font:700 14px -apple-system,Segoe UI,sans-serif;padding:11px 18px;border-radius:12px">Abrir o app</a>
    </td></tr>
    <tr><td style="padding:18px 0 0;font:400 12px/1.5 -apple-system,Segoe UI,sans-serif;color:rgba(26,43,28,.55)">
      Você recebe este resumo porque ativou o aviso diário em Alertas. Para desligar ou trocar o horário, abra o app.
    </td></tr>
  </table></body></html>`
}
