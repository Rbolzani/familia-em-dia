import * as Sentry from "@sentry/nextjs";
import { opcoesComuns } from "./src/lib/sentryScrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  // Redige CPF, CNPJ, e-mail e telefone de eventos e breadcrumbs, e mantem
  // sendDefaultPii desligado. Ver src/lib/sentryScrub.ts.
  ...opcoesComuns,
});
