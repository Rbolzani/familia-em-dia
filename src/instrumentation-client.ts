// Inicialização do Sentry no browser.
//
// A partir do SDK v9 este é o arquivo que o Next/Sentry carregam no cliente —
// o antigo sentry.client.config.ts está descontinuado. Conteúdo idêntico ao
// que estava lá; só mudou o lugar de onde é executado.
import * as Sentry from '@sentry/nextjs'
import { opcoesComuns } from '@/lib/sentryScrub'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Não captura erros em desenvolvimento local
  enabled: process.env.NODE_ENV === 'production',
  // 10% das sessões — ajustar para cima quando tiver mais usuários
  tracesSampleRate: 0.1,
  // Replay apenas quando há erro (não grava sessões normais por privacidade/custo)
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  // Redige CPF, CNPJ, e-mail e telefone de eventos e breadcrumbs, e mantém
  // sendDefaultPii desligado. Ver src/lib/sentryScrub.ts.
  ...opcoesComuns,
})

// Instrumenta as transições de rota do App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
