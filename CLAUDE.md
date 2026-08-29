@AGENTS.md

# Família em Dia — Documentação do Projeto

## O que é o app

Plataforma de gestão familiar para pais brasileiros. Centraliza agenda escolar, saúde e atividades extracurriculares dos filhos, com IA para extração automática de dados, resumo diário via WhatsApp, compartilhamento entre parceiros e cofre de documentos.

**Tagline:** "Organize a vida dos seus filhos com carinho" / "sua rotina, com leveza"
**Público:** mães e pais brasileiros com filhos em idade escolar
**Mercado:** Brasil — português-BR, fuso America/Sao_Paulo, WhatsApp como canal primário

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.7 (App Router) |
| Linguagem | TypeScript 5 |
| UI | React 19 + Tailwind CSS 4 |
| Ícones | Lucide React |
| Banco / Auth | Supabase (PostgreSQL + RLS) |
| IA (extração) | Claude Haiku via @anthropic-ai/sdk |
| IA (voz) | Groq Whisper via openai SDK (baseURL Groq) |
| Pagamentos | Stripe (Checkout, Billing Portal, Webhooks, proração) |
| Notificações | WhatsApp Cloud API (Twilio fallback) |
| PWA | manifest.json — standalone, portrait-primary |

---

## Arquitetura de Pastas

```
src/
  app/
    (app)/            # Páginas autenticadas (layout com sidebar)
      dashboard/      # Tela principal — calendário + atividades do dia
      escola/         # Atividades escolares
      saude/          # Saúde (consultas, vacinas)
      atividades/     # Extracurricular
      ia/             # Captura por IA — foto, texto ou voz
      calendario/     # Calendário mensal
      planos/         # Assinaturas — planos, checkout, cancelar/reativar
    api/
      ai-extract/     # POST: imagem ou texto → atividades/lembretes/docs (Claude)
      voice-transcribe/ # POST: áudio → texto transcrito (Whisper)
      documents/      # Upload e gestão de documentos
      whatsapp-daily/ # Cron — resumo diário via WhatsApp (agenda paga; grace sempre)
      stripe/         # checkout, cancel, portal, webhook
      cron/           # expire-trials — trial→free+grace (fase 1), remoção pós-grace (fase 2)
    auth/             # Login e cadastro
  components/
    activities/       # ActivitiesPage.tsx — modal de criação/edição
    layout/           # AppLayout.tsx — sidebar, topbar, tema
    billing/          # TrialBanner.tsx, GraceBanner.tsx
    ui/               # Modal.tsx, VoiceInputButton.tsx, Toast.tsx, etc.
    access/           # AccessContext — controle de permissões
  hooks/
    useVoiceInput.ts  # MediaRecorder → Whisper → texto
  lib/
    supabase/         # client.ts e server.ts
    billing.ts        # PLAN_LIMITS, getFamilyPlan, getEffectiveSubscription
    stripe.ts         # cliente Stripe, planToPrice/priceToPlan
    stripe-sync.ts    # syncSubscriptionToDb, reconcileUserFromStripe, grace (5 dias)
    types.ts          # Activity, Child, etc.
```

---

## Modelo de Dados (Supabase)

### `activities`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → auth.users |
| child_id | uuid | FK → children |
| category | enum | escola \| saude \| extracurricular |
| title | text | máx ~80 chars |
| description | text \| null | notas adicionais |
| date | date \| null | null = lembrete sem data |
| time | time \| null | |
| location | text \| null | |
| alert_days | int | 0–30 dias de antecedência |
| status | enum | pendente \| concluido \| cancelado |
| ai_generated | bool | gerado via IA |
| takes_user_id | uuid \| null | quem leva |
| picks_user_id | uuid \| null | quem busca |

### `children`
| Campo | Tipo |
|---|---|
| id | uuid |
| user_id | uuid |
| name | text |
| birth_date | date |
| school_name | text \| null |
| avatar_color | text (hex) |
| sort_order | int |

### `subscriptions`
| Campo | Tipo | Notas |
|---|---|---|
| user_id | uuid | PK / FK → auth.users |
| stripe_customer_id | text | cliente no Stripe |
| stripe_subscription_id | text \| null | assinatura vigente |
| plan | enum | free \| familia \| plus |
| status | text | free \| trialing \| active \| ... |
| billing_interval | text \| null | month \| year |
| trial_ends_at | timestamptz \| null | fim do trial original |
| current_period_end | timestamptz \| null | |
| cancel_at_period_end | bool | cancelando no fim do período |
| partner_grace_until | timestamptz \| null | grace de 5 dias do parceiro |
| ai_uses_this_month / ai_uses_reset_at | int / ts | uso de IA no plano free |

> **Plano efetivo da família = plano do owner** (resolvido por `get_family_plan` / `getEffectiveSubscription` a partir de `families.created_by`). Parceiro herda; não tem assinatura própria no contexto compartilhado.

Outras tabelas: `notification_settings` (whatsapp_number, daily_summary_enabled, summary_time), `logistics_suggestions` (sugestões de leva/busca entre membros).

---

## Features Existentes

### 1. Captura por IA (`/ia`)
- **Foto/imagem:** envia para `/api/ai-extract`, Claude Haiku extrai **atividades, lembretes, documentos e mensalidades** (4 classes)
- ⚠️ **Mensalidade exige `due_day`** — sem o dia do mês o item vira lembrete; o prompt proíbe inventá-lo e `sanitizePayments()` descarta valor fora de 1..31 (violaria o CHECK do banco e derrubaria o lote inteiro)
- **Texto livre:** mesmo endpoint, entrada manual
- **Voz (novo):** MediaRecorder → `/api/voice-transcribe` → Whisper → texto no campo → ai-extract

### 2. Calendário (`/calendario`)
- Visão mensal com dots por atividade
- Bottom sheet mobile com detalhe do dia
- Filtro por filho ou categoria

### 3. Atividades por Categoria (`/escola`, `/saude`, `/atividades`)
- Modal de criação/edição com campos: filho, título, data, hora, local, notas, alertas
- Chips de logística: quem leva / quem busca
- Agrupamento por data

### 4. Dashboard (`/dashboard`)
- Saudação por horário + nome
- Atividades de hoje e próxima semana
- Painel de lembretes (atividades sem data)
- Mini calendário

### 5. WhatsApp Daily (`/api/whatsapp-daily`)
- Cron (Vercel) — resumo das atividades do dia + próximos 7 dias
- Meta Cloud API com fallback Twilio
- **Template ativo: `resumo_diario_v3`** (7 params) — seções: data · 🎒 aulas de hoje · 🔥 hoje · 📅 próximos 7 dias · 📌 lembretes · 📄 documentos · 💉 vacinas
- **📌 Lembretes** = `activities` com `date IS NULL` (mural do Dashboard), teto de 8 itens + "… e mais N no app". Sem janela de data: lembrete sem prazo não vence. Não há status "concluído" a filtrar — concluir no mural apaga a linha.
- ⚠️ **A contagem de parâmetros é contrato do template Meta.** Mandar 6 params para um template de 7 (ou vice-versa) faz a Meta rejeitar a mensagem inteira. Flags `WHATSAPP_TEMPLATE_HAS_CLASSES` e `WHATSAPP_TEMPLATE_HAS_REMINDERS` controlam a contagem e devem ser trocadas **junto** com `WHATSAPP_TEMPLATE_NAME`.
- O fallback de `/api/whatsapp-test` monta os params à mão — ao criar uma seção nova, atualizar **os dois** lugares.
- **A agenda diária é recurso pago** (plano free não recebe); o **aviso de grace** é notificação de conta e é entregue mesmo no free

### 6. Compartilhamento
- Parceiro pode ter acesso completo, somente leitura ou somente logística
- Controle via `AccessContext` + Supabase RLS
- **Parceiro herda o plano do owner** (`get_family_plan`/`getEffectiveSubscription`)

### 6b. Mensalidades (`/mensalidades`)
- Pagamentos recorrentes (natação, piano, pedagoga). `payments` = a **regra**; `payment_marks` = as **exceções** (competência `YYYY-MM` paga). Ocorrências são **calculadas**, nunca geradas.
- Cancelar é `active = false` — preserva o histórico do que já foi pago.
- `vencimentoDe()` resolve mês curto no cálculo (dia 31 em fevereiro → 28/29); a regra guardada continua "todo dia 31".
- **Alerta só a partir do vencimento** (avisar antes não muda o comportamento de um PIX), mas o **vencido persiste** até ser pago.
- Superfícies: tela própria · painel de Alertas do dashboard · seção 💰 no resumo do WhatsApp · captura por IA.
- Liberado em **todos os planos**, inclusive o gratuito (o canal WhatsApp é que é pago).

### 7. Cofre de Documentos
- Upload de arquivos (PDF, imagem)
- Categorias: saúde, identidade, contratos, carteirinhas
- Data de vencimento opcional
- Imagem escaneada na IA é auto-anexada ao documento

### 8. Assinaturas / Billing (`/planos`) — Stripe
- Planos **Gratuito / Família / Família Plus**, mensal ou **anual (−20%)**
- **Paywall por plano** (`lib/billing.ts` → `PLAN_LIMITS`): free = 2 filhos, IA 5/mês, sem voz/WhatsApp/compartilhamento
- **Checkout** novo assinante; **troca de plano/intervalo sem novo cartão** (modifica a sub existente com proração + `billing_cycle_anchor:'now'`)
- **Trial 14 dias server-enforced** (sem segundo trial); **cancelamento com motivo** + **reativação**; **portal** com cancelamento desabilitado
- **Reconciliação on-page-load** (`reconcileUserFromStripe`) — robusto a webhook perdido
- **Webhook** `/api/stripe/webhook` (checkout/subscription events → `syncSubscriptionToDb`)

### 9. Grace Period (billing + compartilhamento)
- Owner perde plano pago (pago/trial → grátis) **com parceiro conectado** → **grace de 5 dias** antes da desconexão (`partner_grace_until`)
- Cron `/api/cron/expire-trials`: fase 1 (trial→free+grace), fase 2 (remove parceiro pós-grace)
- Banners (`TrialBanner`/`GraceBanner`) para owner e parceiro; aviso de grace também via WhatsApp
- Fichas de logística do ex-parceiro permanecem; slot órfão volta a ser editável (`LogChip.tsx`)

---

## Módulo de Voz — Implementado

### Decisão de arquitetura
- **Descartado:** Web Speech API — instável no iOS PWA standalone (modo instalado)
- **Escolhido:** OpenAI Whisper via backend — funciona em 100% dos browsers e modos (iOS, Android, Firefox, PWA)
- **Custo:** $0,006/minuto, 100% variável, zero custo fixo

### Fluxo
```
Usuária clica "Voz" → MediaRecorder captura áudio
→ POST /api/voice-transcribe (audio blob)
→ OpenAI Whisper (model: whisper-1, language: pt)
→ texto transcrito → inserido no textarea
→ usuária clica "Analisar com IA"
→ /api/ai-extract → atividades/lembretes/docs
```

### Arquivos do módulo
| Arquivo | Responsabilidade |
|---|---|
| `src/hooks/useVoiceInput.ts` | MediaRecorder, seleção de MIME type (webm/mp4 por SO), estados, envio |
| `src/components/ui/VoiceInputButton.tsx` | Botão com estados idle/recording/transcribing/error |
| `src/app/api/voice-transcribe/route.ts` | Endpoint — recebe audio File, chama Whisper, retorna `{ text }` |
| `src/app/(app)/ia/page.tsx` | Integração — botão "Voz" no modo texto, transcrição concatena no textarea |

### Variável de ambiente necessária
```
GROQ_API_KEY=gsk_...
```

### Formatos de áudio suportados
- Chrome/Android: `audio/webm;codecs=opus`
- iOS Safari/Chrome: `audio/mp4`
- Fallback automático via `MediaRecorder.isTypeSupported()`

---

## Variáveis de Ambiente

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# IA — extração de texto/imagem
ANTHROPIC_API_KEY=

# IA — transcrição de voz (Groq Whisper)
GROQ_API_KEY=

# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
# Template do resumo diário — o nome e as duas flags formam UM conjunto.
# Trocar só um dos três muda a contagem de params e a Meta rejeita o envio.
WHATSAPP_TEMPLATE_NAME=resumo_diario_v3
WHATSAPP_TEMPLATE_HAS_CLASSES=true
WHATSAPP_TEMPLATE_HAS_REMINDERS=true
# Template de 1 param para avisos de conta (grace) — NÃO reutilizar o do resumo
WHATSAPP_TEMPLATE_ACCOUNT=aviso_conta
# Twilio (fallback)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=

# Monitoramento de erros (Sentry) — pendente colar o DSN na Vercel
NEXT_PUBLIC_SENTRY_DSN=

# Suporte (OPCIONAIS — o código tem fallback fixo suporte@familiaemdia.com.br)
# ⚠️ NEXT_PUBLIC_* congela no BUILD: mudar exige rebuild. Não setar com valor de teste.
NEXT_PUBLIC_SUPPORT_EMAIL=
NEXT_PUBLIC_SUPPORT_WHATSAPP=
```

> **E-mail transacional (Resend):** a API key do Resend **não** é env var do Next.js — fica no **Supabase → Auth → SMTP** (envio dos e-mails de auth de `noreply@familiaemdia.com.br`) e no Gmail ("Enviar como" de `dpo@`/`suporte@`). Nunca commitar essa key.

> **Caixas de e-mail de domínio:** `dpo@` e `suporte@familiaemdia.com.br` recebem via **ImprovMX** (encaminha p/ Gmail) e respondem via **Resend** (SMTP). Config de DNS toda no Registro.br. Ver mapa de contas no CLAUDE.md da raiz.

---

## Design System

### Paleta principal (tema Floresta)
```css
--verde-extra-dark: #1E3320
--verde-dark:       #2C4A2E
--verde-medium:     #3D6641
--verde-light:      #5A8C5E
--verde-pale:       #D4E8D5
--terra:            #C49A6C
--bg-creme:         #F8F3EA
--text-main:        #1A2B1C
```

### Temas disponíveis
Floresta (padrão) · Índigo · Âmbar · Rosa · Ardósia

### Tipografia
- Display: Lora (serifada, elegante)
- UI: DM Sans

### Padrões de componente
- Cards com `border-radius` orgânico (ex: `17px 11px 15px 13px`)
- Sombras suaves com inset highlight
- Textura noise sutil via SVG inline
- Animações: `animate-fade-up`, `animate-scale-in`, `animate-slide-up`

### Mobile
- PWA standalone + portrait-primary
- Bottom sheet: padrão para detalhes no mobile (ver `CalendarioClient.tsx`)
- Safe area insets respeitados: `env(safe-area-inset-bottom)`
- `maximumScale: 1` no viewport
- Sidebar: 58px vertical no mobile, 256px horizontal no desktop
