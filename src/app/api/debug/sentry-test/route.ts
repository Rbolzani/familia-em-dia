// Rota TEMPORÁRIA para confirmar que o Sentry está capturando em produção.
//
// Sem ela, um painel vazio no Sentry é ambíguo: pode significar "nenhum erro"
// ou "monitoramento mudo" — foi justamente esse falso "tudo certo" que
// mascarou a instrumentação faltando (o register() do Next nunca rodava).
//
// Exige apenas SESSÃO de usuário logado — nada de segredo em URL nem em
// header. Basta abrir o endereço no navegador já logado no app. Evita expor
// o CRON_SECRET no histórico do navegador e nos logs de acesso da Vercel.
// REMOVER depois de validar.
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Faça login no app e acesse novamente.' }, { status: 401 })
  }

  const dsnConfigurado = !!process.env.NEXT_PUBLIC_SENTRY_DSN

  // Evento explícito: chega ao Sentry mesmo que o tratamento automático de
  // exceções falhe, isolando "o SDK inicializou?" de "o hook de erro pegou?".
  const eventId = Sentry.captureMessage(
    'Teste de monitoramento — Família em Dia',
    'error',
  )
  // Garante o envio antes da função serverless encerrar.
  await Sentry.flush(3000)

  return NextResponse.json({
    ok: true,
    dsnConfigurado,
    ambiente: process.env.NODE_ENV,
    eventId,
    dica: dsnConfigurado
      ? 'Procure este eventId em Issues no Sentry (pode levar alguns segundos).'
      : 'NEXT_PUBLIC_SENTRY_DSN ausente neste build — falta configurar na Vercel e refazer o deploy.',
  })
}
