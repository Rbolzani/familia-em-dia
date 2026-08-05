// Rota TEMPORÁRIA para confirmar que o Sentry está capturando em produção.
//
// Sem ela, um painel vazio no Sentry é ambíguo: pode significar "nenhum erro"
// ou "monitoramento mudo" — foi justamente esse falso "tudo certo" que
// mascarou a instrumentação faltando (o register() do Next nunca rodava).
//
// Protegida pelo CRON_SECRET para não virar um endpoint público capaz de
// poluir a cota de 5.000 erros/mês. REMOVER depois de validar.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

export async function GET(req: NextRequest) {
  // Autenticação por header, NUNCA por query string: um `?secret=` ficaria
  // gravado no histórico do navegador e nos logs de acesso da Vercel — e este
  // é o mesmo segredo que protege o cron do resumo diário.
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
