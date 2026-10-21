// Rotina diária de cobrança do MODELO NOVO (teste com cartão, oferta de
// 20/10/2026). Vercel Cron, 1×/dia às 10h de Brasília.
//
//  1. Cadastro interrompido: conta "incompleto" criada há mais de 24h recebe
//     UM aviso (e-mail E2 + WhatsApp W3, modelo continuar_cadastro).
//  2. Cartão recusado (past_due): no 5º dia, aviso "faltam 2 dias" (E8/W2); no
//     7º dia sem regularizar, a conta é PAUSADA (motivo pagamento) e sai o aviso
//     de pausa (E9). O Stripe segue tentando cobrar: se o pagamento entrar, a
//     sincronização reativa a conta sozinha.
//  3. Conta pausada: avisos de exclusão 30 e 7 dias antes (E10); aos 90 dias da
//     pausa a conta é apagada (mesmo caminho da exclusão pela própria pessoa).
//
// Tudo é idempotente (avisos_conta): rodar duas vezes no mesmo dia não duplica.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { avisarCadastroIncompleto, avisarCartaoRecusado, avisarExclusao, avisarPausa, diasAte } from '@/lib/avisos-conta'
import { DIAS_ATE_APAGAR, DIAS_CARENCIA_CARTAO } from '@/lib/oferta-v2'
import { excluirConta } from '@/lib/excluir-conta'

export const maxDuration = 300

const DIA = 86_400_000

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const agora = new Date()
  const r = { incompletos: 0, cartaoD5: 0, pausadas: 0, avisosExclusao: 0, excluidas: 0, erros: 0 }

  // 1. Cadastro interrompido (uma vez, depois de 24h)
  const { data: incompletos } = await admin.from('subscriptions')
    .select('user_id, created_at').eq('oferta', 'v2').eq('status', 'incompleto')
    .lt('created_at', new Date(agora.getTime() - DIA).toISOString())
    .gt('created_at', new Date(agora.getTime() - 30 * DIA).toISOString())
    .limit(500)
  for (const s of incompletos ?? []) {
    try { if (await avisarCadastroIncompleto(s.user_id as string)) r.incompletos++ }
    catch (e) { r.erros++; console.error('[cobranca] cadastro incompleto:', e) }
  }

  // 2. Cartão recusado: aviso do 5º dia e pausa no 7º
  const { data: atrasadas } = await admin.from('subscriptions')
    .select('user_id, payment_failed_at').eq('oferta', 'v2').eq('status', 'past_due')
    .not('payment_failed_at', 'is', null).limit(500)
  for (const s of atrasadas ?? []) {
    try {
      const falha = new Date(s.payment_failed_at as string)
      const dias = Math.floor((agora.getTime() - falha.getTime()) / DIA)
      if (dias >= DIAS_CARENCIA_CARTAO) {
        const pausadaEm = agora
        await admin.from('subscriptions').update({
          status: 'paused', pause_reason: 'pagamento', paused_at: pausadaEm.toISOString(),
          delete_after: new Date(pausadaEm.getTime() + DIAS_ATE_APAGAR * DIA).toISOString(),
          updated_at: agora.toISOString(),
        }).eq('user_id', s.user_id).eq('status', 'past_due')
        await avisarPausa(s.user_id as string)
        r.pausadas++
      } else if (dias >= 5) {
        await avisarCartaoRecusado(s.user_id as string, 'd5')
        r.cartaoD5++
      }
    } catch (e) { r.erros++; console.error('[cobranca] cartão recusado:', e) }
  }

  // 3. Conta pausada: avisos de exclusão e exclusão aos 90 dias
  const { data: pausadas } = await admin.from('subscriptions')
    .select('user_id, delete_after').eq('oferta', 'v2').eq('status', 'paused')
    .not('delete_after', 'is', null).limit(500)
  for (const s of pausadas ?? []) {
    try {
      const apagar = new Date(s.delete_after as string)
      const dias = diasAte(apagar, agora)
      if (dias <= 0) {
        const { data: u } = await admin.auth.admin.getUserById(s.user_id as string)
        if (!u.user) continue
        const res = await excluirConta(admin, u.user.id, u.user.created_at)
        if (res.ok) r.excluidas++
        else r.erros++
      } else if (dias <= 7) {
        await avisarExclusao(s.user_id as string, 7); r.avisosExclusao++
      } else if (dias <= 30) {
        await avisarExclusao(s.user_id as string, 30); r.avisosExclusao++
      }
    } catch (e) { r.erros++; console.error('[cobranca] conta pausada:', e) }
  }

  try {
    await admin.from('cron_heartbeats').upsert({ name: 'cobranca', ran_at: new Date().toISOString(), result: r }, { onConflict: 'name' })
  } catch (e) { console.error('[cobranca] heartbeat:', e) }
  return NextResponse.json(r)
}
