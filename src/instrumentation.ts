// Ponto de entrada de instrumentação do Next (server + edge).
//
// O Next só executa `register()` deste arquivo — que precisa estar na raiz do
// projeto ou dentro de src/. Sem ele, os sentry.server/edge.config.ts NÃO são
// carregados e nenhum erro de servidor chega ao Sentry, ainda que o DSN esteja
// configurado. Era esse o caso aqui: os configs existiam mas nunca rodavam.
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Captura erros de Server Components / rotas de API. Sem este export, falhas
// no servidor aparecem só no log da Vercel e nunca no Sentry.
export const onRequestError = Sentry.captureRequestError
