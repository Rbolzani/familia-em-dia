// API de Conversões da Meta (envio pelo servidor), par do Meta Pixel do navegador.
//
// POR QUE EXISTE
// A primeira cobrança da oferta com cartão acontece no 15º dia, sem a pessoa no
// site: só o webhook do Stripe sabe que o pagamento saiu. E o Pixel não roda na
// tela de pagamento do Stripe. Então a compra (Purchase) e o início do teste
// (StartTrial) saem daqui, com o mesmo `event_id` que o navegador usa quando
// também vê o evento — a Meta junta os dois e conta uma vez só.
//
// REGRAS
//  · Só envia para quem aceitou os cookies. O aceite (e os cookies _fbp/_fbc)
//    são lidos no navegador na hora de abrir o pagamento e guardados na
//    metadata da assinatura no Stripe (`meta_*`, ver dadosMetaDaAssinatura).
//    Sem `meta_ok = '1'`, nada sai.
//  · Nada de nome, e-mail, telefone ou CPF. `external_id` é o id da conta
//    passado por SHA-256 (pseudônimo, serve para a Meta ligar os eventos).
//  · O token é segredo: só a env var META_CAPI_TOKEN (Vercel, Sensitive).
//    Sem o token, nada é enviado e nada quebra.
//  · Nunca lança: falha de medição não pode derrubar webhook nem retorno do
//    pagamento.

import { createHash } from 'crypto'
import { META_PIXEL_ID } from '@/lib/medicao-ids'

const VERSAO_GRAPH = process.env.META_GRAPH_VERSION || 'v23.0'

export type EventoMeta = {
  nome: 'Purchase' | 'StartTrial' | 'CompleteRegistration' | 'InitiateCheckout'
  /** Igual ao eventID do Pixel no navegador, para a Meta não contar em dobro. */
  eventId: string
  /** Segundos desde 1970. */
  quando: number
  url: string
  usuario: { userId?: string; ip?: string; ua?: string; fbp?: string; fbc?: string }
  dados?: { value?: number; currency?: string; content_name?: string }
}

function token(): string | undefined {
  return process.env.META_CAPI_TOKEN || process.env.META_CAPI_ACCESS_TOKEN || undefined
}

export function metaCapiConfigurada(): boolean {
  return !!token()
}

const sha256 = (s: string) => createHash('sha256').update(s.trim().toLowerCase()).digest('hex')

/** Monta o corpo do envio. Separado para dar para conferir sem mandar nada. */
export function montarCorpo(ev: EventoMeta) {
  const u = ev.usuario
  const user_data: Record<string, unknown> = {}
  if (u.userId) user_data.external_id = [sha256(u.userId)]
  if (u.ip) user_data.client_ip_address = u.ip
  if (u.ua) user_data.client_user_agent = u.ua
  if (u.fbp) user_data.fbp = u.fbp
  if (u.fbc) user_data.fbc = u.fbc
  const corpo: Record<string, unknown> = {
    data: [{
      event_name: ev.nome,
      event_time: ev.quando,
      event_id: ev.eventId,
      action_source: 'website',
      event_source_url: ev.url,
      user_data,
      custom_data: ev.dados ?? {},
    }],
  }
  // Para testar no "Testar eventos" do Gerenciador de Eventos: com esta env
  // var, os eventos aparecem lá e não entram nas estatísticas reais.
  if (process.env.META_TEST_EVENT_CODE) corpo.test_event_code = process.env.META_TEST_EVENT_CODE
  return corpo
}

export async function enviarEventoMeta(ev: EventoMeta): Promise<boolean> {
  const t = token()
  if (!t) return false
  try {
    const res = await fetch(`https://graph.facebook.com/${VERSAO_GRAPH}/${META_PIXEL_ID}/events`, {
      method: 'POST',
      // Token no corpo, não na URL: URL costuma ir parar em logs.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...montarCorpo(ev), access_token: t }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const corpo = await res.json().catch(() => null) as { error?: { message?: string; code?: number } } | null
      console.error('[meta-capi] recusado', ev.nome, res.status, corpo?.error?.code, corpo?.error?.message)
      return false
    }
    console.info('[meta-capi] enviado', ev.nome, ev.eventId)
    return true
  } catch (e) {
    console.error('[meta-capi] falha de rede', ev.nome, (e as Error)?.name)
    return false
  }
}

// ── Dados guardados na assinatura do Stripe ─────────────────────────────────
// Metadata do Stripe aceita até 500 caracteres por valor.
const corta = (s: string | null | undefined, n = 480) => (s ? s.slice(0, n) : '')

/** O que o navegador manda ao abrir o pagamento (ver dadosMetaParaCheckout). */
export type MetaDoNavegador = { ok?: boolean; fbp?: string | null; fbc?: string | null }

/**
 * Metadata `meta_*` para a assinatura. Vazia quando a pessoa não aceitou os
 * cookies — e aí o servidor nunca envia nada por ela.
 */
export function metadataMeta(nav: MetaDoNavegador | undefined, request: Request): Record<string, string> {
  if (!nav?.ok) return {}
  const h = request.headers
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim()
  let url = ''
  try { const r = new URL(h.get('referer') ?? ''); url = r.origin + r.pathname } catch { /* sem referer */ }
  const valido = (c: string | null | undefined) => (c && /^fb\.\d\.\d+\.[\w.-]+$/.test(c) ? c : '')
  return {
    meta_ok: '1',
    meta_fbp: corta(valido(nav.fbp)),
    meta_fbc: corta(valido(nav.fbc)),
    meta_ip: corta(ip, 64),
    meta_ua: corta(h.get('user-agent')),
    meta_url: corta(url, 300),
  }
}

/** Lê de volta a metadata gravada por `metadataMeta`. `null` = sem consentimento. */
export function dadosMetaDaAssinatura(md: Record<string, string> | null | undefined, userId?: string) {
  if (!md || md.meta_ok !== '1') return null
  return {
    url: md.meta_url || 'https://www.familiaemdia.com.br/',
    usuario: {
      userId: userId || md.user_id || undefined,
      ip: md.meta_ip || undefined,
      ua: md.meta_ua || undefined,
      fbp: md.meta_fbp || undefined,
      fbc: md.meta_fbc || undefined,
    },
  }
}
