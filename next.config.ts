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
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in https://api.anthropic.com https://api.groq.com https://graph.facebook.com https://*.ingest.sentry.io",
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
