// Webhook da Meta (WhatsApp Cloud API) — status de ENTREGA das mensagens.
//
// POR QUE EXISTE
// O envio (`sendWhatsApp`) só recebe "aceito". Se a Meta depois não entrega —
// cartão da conta recusado, número sem WhatsApp, limite de envio — o único
// aviso é este webhook. Sem ele, em set/2026 o resumo diário ficou dois dias
// sem chegar a ninguém enquanto todos os logs diziam "enviado com sucesso".
//
// Configuração na Meta (App → WhatsApp → Configuração → Webhook):
//   URL:            https://www.familiaemdia.com.br/api/whatsapp/webhook
//   Token de verif.: valor de WHATSAPP_WEBHOOK_VERIFY_TOKEN
//   Campo assinado: messages
// E WHATSAPP_APP_SECRET (App → Configurações → Básico → Chave secreta) na Vercel.
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { adminClient } from '@/lib/whatsapp'

// ── Verificação (GET) — a Meta chama uma vez ao salvar a URL no painel ──────
export async function GET(request: Request) {
  const url = new URL(request.url)
  const esperado = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (
    esperado &&
    url.searchParams.get('hub.mode') === 'subscribe' &&
    url.searchParams.get('hub.verify_token') === esperado
  ) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

// A Meta pode mandar os status fora de ordem (o "read" antes do "delivered").
// Só avançamos; `failed` é final e sempre vence.
const ORDEM: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 9 }

interface StatusMeta {
  id: string
  status: string
  timestamp?: string
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
}

// Assinatura HMAC do corpo CRU com a chave secreta do app. Sem ela, qualquer
// um poderia marcar mensagens como entregues ou falhas.
function assinaturaValida(corpo: string, cabecalho: string | null): boolean {
  const segredo = process.env.WHATSAPP_APP_SECRET
  if (!segredo || !cabecalho?.startsWith('sha256=')) return false
  const esperado = createHmac('sha256', segredo).update(corpo).digest()
  const recebido = Buffer.from(cabecalho.slice(7), 'hex')
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

export async function POST(request: Request) {
  const corpo = await request.text()
  if (!assinaturaValida(corpo, request.headers.get('x-hub-signature-256'))) {
    console.error('[whatsapp-webhook] assinatura inválida ou WHATSAPP_APP_SECRET ausente')
    return new Response('Unauthorized', { status: 401 })
  }

  let statuses: StatusMeta[] = []
  try {
    const json = JSON.parse(corpo) as {
      entry?: { changes?: { value?: { statuses?: StatusMeta[] } }[] }[]
    }
    statuses = (json.entry ?? []).flatMap(e =>
      (e.changes ?? []).flatMap(c => c.value?.statuses ?? []))
  } catch {
    return NextResponse.json({ ok: true }) // corpo que não entendemos: não reenviar
  }

  const admin = adminClient()
  for (const s of statuses) {
    if (!s.id || !(s.status in ORDEM)) continue
    const quando = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString()
    const erro = s.errors?.[0]

    const { data: atual } = await admin
      .from('whatsapp_messages').select('status, user_id, kind').eq('wamid', s.id).maybeSingle()
    if (atual && ORDEM[atual.status] >= ORDEM[s.status]) continue

    const { error } = await admin.from('whatsapp_messages').upsert({
      wamid: s.id,
      status: s.status,
      status_at: quando,
      ...(erro ? {
        error_code: erro.code ?? null,
        error_title: erro.title ?? erro.message ?? null,
        error_detail: erro.error_data?.details ?? null,
      } : {}),
    }, { onConflict: 'wamid' })
    if (error) console.error('[whatsapp-webhook] gravação falhou:', error.message)

    if (s.status === 'failed') {
      // console.error chega ao Sentry quando o DSN estiver configurado.
      console.error('[whatsapp-webhook] ENTREGA FALHOU — %s %s (%s) user=%s kind=%s',
        erro?.code ?? '?', erro?.title ?? '', erro?.error_data?.details ?? '',
        atual?.user_id ?? '?', atual?.kind ?? '?')
    }
  }

  // Sempre 200 depois de autenticado: a Meta reenvia em caso de erro, e um
  // reenvio infinito por causa de uma linha ruim não ajuda ninguém.
  return NextResponse.json({ ok: true })
}
