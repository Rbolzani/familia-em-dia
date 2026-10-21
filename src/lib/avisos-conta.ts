// Server-only: avisos da conta do MODELO NOVO (teste com cartão), por e-mail e
// WhatsApp. Textos aprovados pelo Rogério em 20/10/2026 —
// Nova-Oferta-Textos-para-aprovacao.md (E1–E10, W1–W4).
// ⚠️ Mudar aqui é mudar o que o cliente lê: o Rogério aprova o texto.
//
// São avisos sobre o estado da conta que a pessoa abriu (teste, cobrança,
// cartão, pausa, exclusão): não dependem do opt-in de comunicações
// promocionais. O WhatsApp sai para TODOS os planos, inclusive o Básico — não
// é o resumo diário (recurso pago), é aviso de conta.
//
// IDEMPOTÊNCIA: cada aviso tem um registro em `avisos_conta` (pessoa × tipo ×
// chave), gravado ANTES do envio. Se nada chegar (e-mail e WhatsApp falharam),
// o registro é desfeito para a próxima tentativa.
//
// MODELOS DA META (criados pelo Rogério no WhatsApp Manager):
//   aviso_cobranca      Utilidade · {{1}} quando · {{2}} data · {{3}} plano · {{4}} valor · botão Gerenciar assinatura
//   aviso_pagamento     Utilidade · {{1}} plano · {{2}} frase do dia · botão Atualizar cartão
//   continuar_cadastro  Marketing · {{1}} nome · botão Continuar cadastro
//   aviso_conta         Utilidade (já existia) · {{1}} frase livre
// Os nomes podem ser trocados por env (WHATSAPP_TEMPLATE_COBRANCA, …_PAGAMENTO,
// …_CONTINUAR, …_ACCOUNT) sem mudar código.

import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmail } from '@/lib/email'
import { LEGAL_ENTITY } from '@/lib/legal'
import { stripe } from '@/lib/stripe'
import { resolveWhatsAppNumber, sendWhatsApp } from '@/lib/whatsapp'
import {
  COMPARATIVO, DIAS_TESTE, NOME_PLANO, valorDaCobranca, type Celula, type Ciclo, type PlanoPago,
} from '@/lib/planos-oferta'
import { DIAS_CARENCIA_CARTAO } from '@/lib/oferta-v2'

type Admin = ReturnType<typeof createAdminClient>

const SITE = 'https://www.familiaemdia.com.br'
export const LINK_GERENCIAR = `${SITE}/planos`
export const LINK_CARTAO = `${SITE}/planos?acao=cartao`
export const LINK_REATIVAR = `${SITE}/assinar?reativar=1`
export const LINK_CONTINUAR = `${SITE}/auth/login?continuar=1`
const REMETENTE = `Família em Dia <${LEGAL_ENTITY.email}>`
const RODAPE = 'Você recebeu este e-mail porque tem uma conta em familiaemdia.com.br.'

const TPL = {
  cobranca: () => process.env.WHATSAPP_TEMPLATE_COBRANCA || 'aviso_cobranca',
  pagamento: () => process.env.WHATSAPP_TEMPLATE_PAGAMENTO || 'aviso_pagamento',
  continuar: () => process.env.WHATSAPP_TEMPLATE_CONTINUAR || 'continuar_cadastro',
  conta: () => process.env.WHATSAPP_TEMPLATE_ACCOUNT || 'aviso_conta',
}

// ── Datas (fuso de Brasília) ────────────────────────────────────────────────
export function dataCurta(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}
const diaSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
/** Dias de calendário (Brasília) até `fim`. */
export function diasAte(fim: Date, agora = new Date()): number {
  return Math.round((Date.parse(diaSP(fim)) - Date.parse(diaSP(agora))) / 86_400_000)
}
function quando(fim: Date, agora = new Date()): string {
  const d = diasAte(fim, agora)
  return d <= 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d} dias`
}

// ── Contexto da pessoa ──────────────────────────────────────────────────────
interface Ctx {
  userId: string
  email: string | null
  nome: string | null          // primeiro nome
  plano: PlanoPago
  ciclo: Ciclo
  status: string
  fimTeste: Date | null
  fimPeriodo: Date | null
  pausadaEm: Date | null
  motivoPausa: string | null
  apagarEm: Date | null
  falhaEm: Date | null
  subId: string | null
  cancelando: boolean
}

async function contexto(admin: Admin, userId: string): Promise<Ctx | null> {
  const [{ data: u }, { data: p }, { data: s }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
    admin.from('subscriptions').select('plan, billing_interval, status, oferta, trial_ends_at, current_period_end, paused_at, pause_reason, delete_after, payment_failed_at, stripe_subscription_id, cancel_at_period_end').eq('user_id', userId).maybeSingle(),
  ])
  if (!s || s.oferta !== 'v2') return null
  const d = (v: unknown) => (v ? new Date(v as string) : null)
  const plano = (['basico', 'familia', 'plus'].includes(s.plan as string) ? s.plan : 'familia') as PlanoPago
  return {
    userId,
    email: u.user?.email ?? null,
    nome: (p?.full_name as string | null)?.trim().split(/\s+/)[0] || null,
    plano,
    ciclo: s.billing_interval === 'year' ? 'year' : 'month',
    status: s.status as string,
    fimTeste: d(s.trial_ends_at),
    fimPeriodo: d(s.current_period_end),
    pausadaEm: d(s.paused_at),
    motivoPausa: (s.pause_reason as string | null) ?? null,
    apagarEm: d(s.delete_after),
    falhaEm: d(s.payment_failed_at),
    subId: (s.stripe_subscription_id as string | null) ?? null,
    cancelando: !!s.cancel_at_period_end,
  }
}

/** Final do cartão da assinatura ("final 1234"), ou "cadastrado". */
async function finalDoCartao(subId: string | null): Promise<string> {
  if (!subId) return 'cadastrado'
  try {
    const sub = await stripe.subscriptions.retrieve(subId, { expand: ['default_payment_method'] })
    const pm = sub.default_payment_method
    const last4 = pm && typeof pm !== 'string' ? pm.card?.last4 : null
    return last4 ? `final ${last4}` : 'cadastrado'
  } catch { return 'cadastrado' }
}

// ── Registro (idempotência) ─────────────────────────────────────────────────
async function marcar(admin: Admin, userId: string, tipo: string, chave: string): Promise<boolean> {
  const { error } = await admin.from('avisos_conta').insert({ user_id: userId, tipo, chave })
  return !error   // conflito de chave = já enviado
}
async function concluir(admin: Admin, userId: string, tipo: string, chave: string, whatsapp: boolean, email: boolean) {
  if (!whatsapp && !email) await admin.from('avisos_conta').delete().eq('user_id', userId).eq('tipo', tipo).eq('chave', chave)
  else await admin.from('avisos_conta').update({ whatsapp, email }).eq('user_id', userId).eq('tipo', tipo).eq('chave', chave)
}

// ── E-mail ──────────────────────────────────────────────────────────────────
interface Email { assunto: string; paragrafos: string[]; botao?: { texto: string; link: string }; depois?: string[]; tabela?: boolean }

const FONTE = '-apple-system,Segoe UI,sans-serif'
function tabelaHtml(destaque: PlanoPago): string {
  const cel = (v: Celula, d: boolean) =>
    `<td style="padding:7px 4px;text-align:center;font:${d ? 700 : 400} 12.5px/1.3 ${FONTE};color:${v === false ? '#B8BFB5' : '#1A2B1C'};border-top:1px solid #EFE8DA;${d ? 'background:#EEF4EE;' : ''}">${v === true ? '✓' : v === false ? '—' : v}</td>`
  const cab = (p: PlanoPago) => `<td style="text-align:center;font:${p === destaque ? 800 : 700} 12.5px ${FONTE};color:${p === destaque ? '#2C4A2E' : '#1A2B1C'};padding:6px 4px;${p === destaque ? 'background:#EEF4EE;border-radius:8px 8px 0 0' : ''}">${NOME_PLANO[p]}</td>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr><td></td>${cab('basico')}${cab('familia')}${cab('plus')}</tr>
      ${COMPARATIVO.map(l => `<tr><td style="padding:7px 6px 7px 0;font:400 12.5px/1.3 ${FONTE};color:#4A5A4C;border-top:1px solid #EFE8DA">${l.recurso}</td>${cel(l.basico, destaque === 'basico')}${cel(l.familia, destaque === 'familia')}${cel(l.plus, destaque === 'plus')}</tr>`).join('\n      ')}
    </table>`
}
function tabelaTexto(): string {
  const t = (v: Celula) => (v === true ? 'sim' : v === false ? 'não' : v)
  return COMPARATIVO.map(l => `${l.recurso}: Básico ${t(l.basico)} · Família ${t(l.familia)} · Plus ${t(l.plus)}`).join('\n')
}
const negritoHtml = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
const semNegrito = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1')

function emailHtml(e: Email, plano: PlanoPago): string {
  const p = (t: string) => `<tr><td style="padding:0 0 14px;font:400 15px/1.6 ${FONTE};color:#1A2B1C">${negritoHtml(t)}</td></tr>`
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8F3EA;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:22px 24px">
    ${e.paragrafos.map(p).join('\n    ')}
    ${e.botao ? `<tr><td style="padding:4px 0 22px"><a href="${e.botao.link}" style="display:inline-block;background:#3D6641;color:#fff;text-decoration:none;font:700 14px ${FONTE};padding:12px 20px;border-radius:12px">${e.botao.texto}</a></td></tr>` : ''}
    ${(e.depois ?? []).map(p).join('\n    ')}
    ${e.tabela ? `<tr><td style="padding:0 0 8px;font:700 14px ${FONTE};color:#1A2B1C">Compare os planos</td></tr><tr><td style="padding:0 0 18px">${tabelaHtml(plano)}</td></tr>` : ''}
    <tr><td style="padding:8px 0 0;border-top:1px solid #EFE8DA;font:400 12px/1.5 ${FONTE};color:#7A8577"><div style="padding-top:12px">${RODAPE}</div></td></tr>
  </table></body></html>`
}
function emailTexto(e: Email): string {
  return [
    ...e.paragrafos.map(semNegrito),
    ...(e.botao ? [`${e.botao.texto}: ${e.botao.link}`] : []),
    ...(e.depois ?? []).map(semNegrito),
    ...(e.tabela ? ['Compare os planos:\n' + tabelaTexto()] : []),
    RODAPE,
  ].join('\n\n')
}
async function mandarEmail(c: Ctx, e: Email): Promise<boolean> {
  if (!c.email) return false
  const r = await enviarEmail(c.email, e.assunto, emailHtml(e, c.plano), emailTexto(e), { de: REMETENTE, responderPara: LEGAL_ENTITY.email })
  if (!r.ok) console.error('[avisos-conta] e-mail "%s":', e.assunto, r.naoConfigurado ? 'sem RESEND_API_KEY' : r.erro)
  return r.ok
}
async function mandarWhatsApp(admin: Admin, userId: string, params: string | string[], modelo: string, kind: string): Promise<boolean> {
  const numero = await resolveWhatsAppNumber(admin, userId)
  if (!numero) return false
  const r = await sendWhatsApp(numero, params, modelo, { userId, kind })
  if (!r.ok) console.error('[avisos-conta] WhatsApp %s:', modelo, r.error)
  return r.ok
}

const ola = (c: Ctx) => (c.nome ? `Olá, ${c.nome}!` : 'Olá!')
const nomePlano = (c: Ctx) => NOME_PLANO[c.plano]
const valor = (c: Ctx) => valorDaCobranca(c.plano, c.ciclo)
const valorCurto = (c: Ctx) => valor(c).replace(/ por (mês|ano)$/, '')

// ── E1 — Confirmação do teste (no cadastro; exigência da Visa) ──────────────
export async function avisarInicioDoTeste(userId: string): Promise<void> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || c.status !== 'trialing' || !c.fimTeste || !c.subId) return
  if (!(await marcar(admin, userId, 'confirmacao_teste', c.subId))) return
  const fim = dataCurta(c.fimTeste)
  const cartao = await finalDoCartao(c.subId)
  const email = await mandarEmail(c, {
    assunto: 'Seu teste grátis do Família em Dia começou',
    paragrafos: [
      ola(c),
      `Seu teste de ${DIAS_TESTE} dias do plano **${nomePlano(c)}** começou. Até **${fim}** você usa tudo sem pagar nada.`,
      `**Resumo da sua assinatura**<br>• Plano: ${nomePlano(c)}, ${c.ciclo === 'year' ? 'anual' : 'mensal'}<br>• Primeira cobrança: **${fim}**, de **${valorCurto(c)}** no cartão ${cartao}<br>• Depois: ${valor(c)}, até você cancelar`,
      `**Quer cancelar?** É só abrir **Planos** no app e tocar em "Cancelar assinatura" — cancelando até ${fim}, nada é cobrado.`,
    ],
    botao: { texto: 'Gerenciar assinatura', link: LINK_GERENCIAR },
    depois: [
      'Para começar bem: fotografe o bilhete da escola ou a agenda da semana e veja a IA organizar tudo.',
      'Qualquer dúvida, responda este e-mail.',
    ],
  })
  await concluir(admin, userId, 'confirmacao_teste', c.subId, false, email)
}

// ── E2 + W3 — Cadastro interrompido (uma vez, 24h depois) ───────────────────
export async function avisarCadastroIncompleto(userId: string): Promise<{ email: boolean; whatsapp: boolean } | null> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || c.status !== 'incompleto') return null
  if (!(await marcar(admin, userId, 'cadastro_incompleto', ''))) return null
  const email = await mandarEmail(c, {
    assunto: 'Seu cadastro no Família em Dia ficou pela metade',
    paragrafos: [
      ola(c),
      `Você começou seu cadastro, mas ele ainda não foi concluído. Falta pouco: escolha o plano e cadastre o cartão para começar seus **${DIAS_TESTE} dias grátis**. Cancelando antes do fim do teste, nada é cobrado.`,
    ],
    botao: { texto: 'Continuar cadastro', link: LINK_CONTINUAR },
    depois: ['Ficou alguma dúvida ou deu algum problema? Responda este e-mail que a gente ajuda.'],
  })
  const whatsapp = await mandarWhatsApp(admin, userId, [c.nome ?? 'tudo bem'], TPL.continuar(), 'cadastro_incompleto')
  await concluir(admin, userId, 'cadastro_incompleto', '', whatsapp, email)
  return { email, whatsapp }
}

// ── E3/E4/E5 + W1 — Antes da primeira cobrança (7 dias, 3 dias, véspera) ────
// Registrado em `aviso_fim_teste` (etapas d7/d3/d1) para o Painel do negócio.
const RECURSOS_PROXIMO: Record<PlanoPago, { proximo: PlanoPago; recursos: string } | null> = {
  basico: { proximo: 'familia', recursos: 'rede de apoio, reconhecimento por voz, resumo diário no WhatsApp e reconhecimento ilimitado' },
  familia: { proximo: 'plus', recursos: 'filhos e rede de apoio ilimitados, cofre de 5 GB e suporte prioritário' },
  plus: null,
}

export async function avisarAntesDaCobranca(userId: string, etapa: 'd7' | 'd3' | 'd1', token?: string): Promise<{ email: boolean; whatsapp: boolean }> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || c.status !== 'trialing' || !c.fimTeste || c.cancelando) return { email: false, whatsapp: false }
  const fim = dataCurta(c.fimTeste)
  const cartao = await finalDoCartao(c.subId)
  const gerenciar = token ? `${SITE}/api/e/c?t=${token}` : LINK_GERENCIAR
  let e: Email
  if (etapa === 'd7') {
    e = {
      assunto: 'Faltam 7 dias para o fim do seu teste grátis',
      paragrafos: [
        ola(c),
        `Seu teste grátis do plano **${nomePlano(c)}** termina em **${fim}**. Nesse dia será feita a primeira cobrança, de **${valorCurto(c)}**, no cartão ${cartao}.`,
        'Quer continuar? Não precisa fazer nada.',
        `Quer trocar de plano ou cancelar? Abra **Planos** no app — cancelando até ${fim}, nada é cobrado.`,
      ],
      botao: { texto: 'Gerenciar assinatura', link: gerenciar },
      tabela: true,
    }
  } else {
    const prox = RECURSOS_PROXIMO[c.plano]
    e = {
      assunto: etapa === 'd3' ? 'Seu teste grátis termina em 3 dias' : 'Amanhã: primeira cobrança da sua assinatura',
      paragrafos: [
        ola(c),
        `Seu teste grátis do plano **${nomePlano(c)}** termina ${quando(c.fimTeste)}, em **${fim}**, com a primeira cobrança de **${valorCurto(c)}** no cartão ${cartao}.`,
        ...(prox ? [`No seu plano você não tem ${prox.recursos}. Quer testar o ${NOME_PLANO[prox.proximo]} antes da primeira cobrança? É só trocar no app — o teste continua até a mesma data.`] : []),
      ],
      botao: { texto: 'Gerenciar assinatura', link: gerenciar },
      depois: [`Para trocar de plano ou cancelar, use o botão acima. Cancelando até ${fim}, nada é cobrado.`],
    }
  }
  const email = await mandarEmail(c, e)
  // W1 só nos avisos de 3 dias e véspera (o de 7 dias é só e-mail).
  const whatsapp = etapa === 'd7' ? false
    : await mandarWhatsApp(admin, userId, [quando(c.fimTeste), fim, nomePlano(c), valor(c)], TPL.cobranca(), 'fim_teste')
  return { email, whatsapp }
}

// ── E6 + W4 — Cancelamento confirmado ───────────────────────────────────────
export async function avisarCancelamento(userId: string): Promise<void> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || !c.cancelando) return
  const noTeste = c.status === 'trialing'
  const ate = noTeste ? c.fimTeste : c.fimPeriodo
  if (!ate) return
  const chave = ate.toISOString().slice(0, 10)
  if (!(await marcar(admin, userId, 'cancelamento', chave))) return
  const d = dataCurta(ate)
  const email = await mandarEmail(c, {
    assunto: 'Sua assinatura foi cancelada',
    paragrafos: [
      ola(c),
      noTeste
        ? 'Confirmamos o cancelamento da sua assinatura. **Nenhuma cobrança será feita.**'
        : `Confirmamos o cancelamento da sua assinatura. **Não haverá novas cobranças. Você continua usando até ${d}, fim do período já pago.**`,
      noTeste
        ? `Você continua usando o plano ${nomePlano(c)} normalmente **até ${d}**. Depois disso, a conta é pausada e seus dados ficam guardados por 90 dias — dá para reativar quando quiser.`
        : 'Depois disso, a conta é pausada e seus dados ficam guardados por 90 dias — dá para reativar quando quiser.',
      'Se puder, conte por que cancelou respondendo este e-mail. Isso nos ajuda muito.',
    ],
  })
  const frase = noTeste
    ? `Sua assinatura do Família em Dia foi cancelada e nenhuma cobrança será feita. Você continua usando o plano ${nomePlano(c)} normalmente até ${d}.`
    : `Sua assinatura do Família em Dia foi cancelada. Você continua usando o plano ${nomePlano(c)} até ${d}, sem novas cobranças.`
  const whatsapp = await mandarWhatsApp(admin, userId, frase, TPL.conta(), 'cancelamento')
  await concluir(admin, userId, 'cancelamento', chave, whatsapp, email)
}

// ── E7/E8 + W2 — Cartão recusado (dia 0 e dia 5) ────────────────────────────
export async function avisarCartaoRecusado(userId: string, dia: 'd0' | 'd5'): Promise<void> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || c.status !== 'past_due' || !c.falhaEm) return
  const chave = c.falhaEm.toISOString().slice(0, 10)
  const tipo = `cartao_${dia}`
  if (!(await marcar(admin, userId, tipo, chave))) return
  const limite = dataCurta(new Date(c.falhaEm.getTime() + DIAS_CARENCIA_CARTAO * 86_400_000))
  const cartao = await finalDoCartao(c.subId)
  const e: Email = dia === 'd0'
    ? {
        assunto: 'Não conseguimos cobrar sua assinatura',
        paragrafos: [
          ola(c),
          `A cobrança de **${valorCurto(c)}** da sua assinatura do plano ${nomePlano(c)} foi recusada pelo cartão ${cartao}. Sua conta continua funcionando normalmente até **${limite}** enquanto tentamos de novo.`,
          'Para evitar a pausa, atualize o cartão:',
        ],
        botao: { texto: 'Atualizar cartão', link: LINK_CARTAO },
        depois: ['Se o cartão for atualizado, cobramos uma vez só — nada em dobro.'],
      }
    : {
        assunto: 'Faltam 2 dias para sua conta ser pausada',
        paragrafos: [
          ola(c),
          `Ainda não conseguimos cobrar a assinatura do plano ${nomePlano(c)}. Se o cartão não for atualizado até **${limite}**, a conta será pausada: você continua vendo seus dados, mas não poderá criar nem editar.`,
        ],
        botao: { texto: 'Atualizar cartão', link: LINK_CARTAO },
      }
  const email = await mandarEmail(c, e)
  const frase = dia === 'd0'
    ? `Sua conta continua funcionando até ${limite} enquanto tentamos de novo.`
    : `Faltam 2 dias: em ${limite} a conta será pausada.`
  const whatsapp = await mandarWhatsApp(admin, userId, [nomePlano(c), frase], TPL.pagamento(), tipo)
  await concluir(admin, userId, tipo, chave, whatsapp, email)
}

// ── E9 + W2/W4 — Conta pausada (e aviso aos convidados — T17) ───────────────
export async function avisarPausa(userId: string): Promise<void> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || c.status !== 'paused' || !c.pausadaEm || !c.apagarEm) return
  const chave = c.pausadaEm.toISOString().slice(0, 10)
  if (!(await marcar(admin, userId, 'pausa', chave))) return
  const apagar = dataCurta(c.apagarEm)
  const porPagamento = c.motivoPausa === 'pagamento'
  const email = await mandarEmail(c, {
    assunto: 'Sua conta do Família em Dia foi pausada',
    paragrafos: [
      ola(c),
      porPagamento
        ? 'Como não conseguimos cobrar a assinatura, sua conta foi pausada hoje.'
        : 'Como sua assinatura foi cancelada, a conta foi pausada hoje, ao fim do período.',
      `Você ainda pode entrar e ver sua agenda e seus documentos, mas não pode criar nem editar. Seus dados ficam guardados até **${apagar}**; depois disso, a conta é apagada.`,
      'Para voltar a usar, reative a assinatura:',
    ],
    botao: { texto: 'Reativar', link: LINK_REATIVAR },
  })
  const whatsapp = porPagamento
    ? await mandarWhatsApp(admin, userId, [nomePlano(c), 'Sua conta foi pausada hoje, e seus dados ficam guardados por 90 dias.'], TPL.pagamento(), 'pausa')
    : await mandarWhatsApp(admin, userId, `Sua conta do Família em Dia foi pausada. Seus dados ficam guardados até ${apagar}; para voltar a usar, reative a assinatura no app.`, TPL.conta(), 'pausa')
  await concluir(admin, userId, 'pausa', chave, whatsapp, email)

  // T17/W4 — convidados da família ficam só com leitura.
  const { data: fam } = await admin.from('families').select('id, name').eq('created_by', userId).maybeSingle()
  if (!fam?.id) return
  const { data: membros } = await admin.from('family_members').select('user_id').eq('family_id', fam.id).eq('role', 'partner')
  const dono = c.nome ?? (fam.name as string | null) ?? 'quem te convidou'
  for (const m of membros ?? []) {
    const pid = m.user_id as string
    if (!(await marcar(admin, pid, 'pausa_convidado', `${userId}:${chave}`))) continue
    const ok = await mandarWhatsApp(admin, pid, `A conta de ${dono} no Família em Dia foi pausada. Você pode ver a agenda, mas não editar, até que ${dono} reative a assinatura.`, TPL.conta(), 'pausa_convidado')
    await concluir(admin, pid, 'pausa_convidado', `${userId}:${chave}`, ok, false)
  }
}

// ── E10 — Aviso de exclusão (30 e 7 dias antes) ─────────────────────────────
export async function avisarExclusao(userId: string, dias: 30 | 7): Promise<void> {
  const admin = createAdminClient()
  const c = await contexto(admin, userId)
  if (!c || c.status !== 'paused' || !c.apagarEm || !c.pausadaEm) return
  const tipo = `exclusao_${dias}`
  const chave = c.apagarEm.toISOString().slice(0, 10)
  if (!(await marcar(admin, userId, tipo, chave))) return
  const email = await mandarEmail(c, {
    assunto: `Seus dados serão apagados em ${dias} dias`,
    paragrafos: [
      ola(c),
      `Sua conta está pausada desde ${dataCurta(c.pausadaEm)} e será **apagada em ${dataCurta(c.apagarEm)}**, junto com os filhos, a agenda e os documentos do cofre. Isso não pode ser desfeito.`,
      'Se quiser guardar algum documento, abra o cofre no app antes dessa data.',
      'Quer voltar a usar?',
    ],
    botao: { texto: 'Reativar assinatura', link: LINK_REATIVAR },
  })
  await concluir(admin, userId, tipo, chave, false, email)
}
