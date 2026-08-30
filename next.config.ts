import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
  {
    // Permite: próprio domínio, Supabase (auth + storage + realtime),
    // Anthropic (IA), Twilio (WhatsApp), Google Fonts, Vercel Analytics
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Scripts: próprio domínio + inline necessário para Next.js + Supabase Realtime
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Estilos: inline (Tailwind em runtime / style props) + Google Fonts
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Fontes
      "font-src 'self' https://fonts.gstatic.com",
      // Imagens: próprio domínio + Supabase Storage (avatars, documents)
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
      // Conexões: Supabase REST/Auth/Realtime + Anthropic + APIs externas
      // api.twilio.com saiu: o Twilio foi abandonado e o número liberado em
      // 10/08/2026. Permissão que não serve a nada é só superfície extra.
      // ⚠️ `*.` no CSP casa por SUFIXO DE DOMÍNIO, e o host do Sentry tem o
      // segmento da REGIÃO no meio: o DSN aponta para
      //   o<org>.ingest.us.sentry.io
      // que termina em `.us.sentry.io` — logo `*.ingest.sentry.io` NÃO casa.
      // O efeito era silencioso e pior que não ter Sentry: a biblioteca
      // carregava, capturava os erros e o navegador bloqueava todo envio
      // ("Refused to connect ... violates the document's Content Security
      // Policy"). Monitoramento em pé e cego.
      // `*.sentry.io` cobre qualquer região (us, de, …) e sobrevive a uma
      // troca de região do projeto, que quebraria o host fixo de novo.
      // ⚠️ O apex e o www são ORIGENS DIFERENTES para o navegador, e o apex
      // responde 308 para o www — inclusive em /api. Uma página servida no
      // apex faz `fetch('/api/...')`, o 308 leva para outro domínio, e o
      // `'self'` sozinho barra: o navegador reporta "Failed to fetch", sem
      // status e sem log no servidor. Os dois domínios ficam explícitos aqui
      // para que o CSP nunca seja a causa desse sintoma.
      "connect-src 'self' https://familiaemdia.com.br https://www.familiaemdia.com.br https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in https://api.anthropic.com https://api.groq.com https://graph.facebook.com https://*.sentry.io",
      // Frames: nenhum
      "frame-src 'none'",
      // frame-src diz o que ESTA página pode embutir; frame-ancestors diz quem
      // pode embutir ELA — são coisas diferentes, e só a segunda barra
      // clickjacking. Até agora isso dependia só do X-Frame-Options, que é o
      // mecanismo legado. 'self' espelha o SAMEORIGIN já enviado.
      "frame-ancestors 'self'",
      // Workers (Supabase Realtime usa SharedWorker em alguns ambientes)
      "worker-src 'self' blob:",
      // Manifesto PWA
      "manifest-src 'self'",
      // Media: microfone para captura de voz
      "media-src 'self' blob:",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // `sharp` carrega binário nativo (libvips) em tempo de execução. Empacotado
  // pelo bundler, o require do binário quebra em produção — e quebra no
  // CARREGAMENTO do módulo, derrubando a rota inteira antes de qualquer
  // linha rodar. Foi o que aconteceu com /api/documents/ocr: 500 em 1,8s,
  // rápido demais para ter chegado à IA.
  serverExternalPackages: ['sharp'],
  // Libera acesso ao dev server pela rede local (celular no mesmo Wi-Fi).
  // Afeta apenas o ambiente de desenvolvimento.
  allowedDevOrigins: ["192.168.0.20"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "familia-em-dia",
  project: "familia-em-dia",
  silent: !process.env.CI,
  sourcemaps: { disable: true },
});
