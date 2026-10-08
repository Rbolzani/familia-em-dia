// Dados do Painel do negócio (/admin). Só roda no servidor, com a chave de
// serviço — quem chama é responsável por já ter conferido `fundadorLogado()`.
//
// O que entra: cadastro, assinatura e CONTAGENS de uso. O que nunca entra:
// conteúdo dos clientes (nomes de filhos, agenda, documentos do cofre).

import type Stripe from 'stripe'
import { stripe, planoDoPreco, ehPrecoLancamento } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { VAGAS_LANCAMENTO } from '@/lib/oferta-lancamento'

const DIA = 86_400_000

export interface LinhaTeste {
  nome: string; email: string; celular: string | null
  fimDoTeste: string; diasRestantes: number; deixouCartao: boolean
  origem: string; filhos: number; atividades: number; ultimoAcesso: string | null
}
/** Criou a conta e parou antes de concluir o cadastro. Só há e-mail: nome e celular ficam na etapa que faltou. */
export interface LinhaIncompleto {
  email: string; criadoEm: string; emailConfirmado: boolean
  fimDoTeste: string | null; ultimoAcesso: string | null; lembreteEm: string | null
}
export interface LinhaAssinante {
  nome: string; email: string; plano: string; lancamento: boolean
  periodo: 'Mensal' | 'Anual'; centavos: number
  proximaCobranca: string | null; desde: string; cancelaNoFim: boolean
}
export interface LinhaCancelamento {
  nome: string; plano: string; canceladoEm: string; dias: number
  motivo: string | null; comentario: string | null; reembolsado: boolean
}
export interface LinhaOrigem { origem: string; cadastros: number; assinaram: number }
export interface LinhaTempo { faixa: string; cadastros: number; pagantes: number }

// Dias de teste grátis. É o marco que separa "desistiu ainda no teste" de
// "ficou depois do teste".
const DIAS_TESTE = 14

export interface PainelNegocio {
  resumo: {
    cadastros: number; emTeste: number; assinantes: number; gratuito: number; cancelaram: number
    receitaMensalCentavos: number; vagasUsadas: number; vagasTotal: number
    cortesia: number; convidados: number; incompletos: number
    pagantesFamilia: number; pagantesPlus: number
  }
  funil: { criaram: number; concluiram: number; comFilho: number; usaramIa: number; assinaram: number; cancelaram: number }
  /** O que aconteceu em relação aos 14 dias de teste. Grupos sem sobreposição. */
  retencao: { cancelouNoTeste: number; ficouGratis: number; pagandoApos: number; cancelouApos: number }
  /** Há quanto tempo estão na base: cadastros (pela criação da conta) e pagantes (pelo início da assinatura). */
  tempoDeBase: LinhaTempo[]
  emTeste: LinhaTeste[]
  incompletos: LinhaIncompleto[]
  assinantes: LinhaAssinante[]
  cancelamentos: LinhaCancelamento[]
  origem: LinhaOrigem[]
  campanhas: LinhaOrigem[]
  /** Falhas parciais (ex.: Stripe fora do ar) — o resto do painel continua valendo. */
  avisos: string[]
}

const MOTIVOS: Record<string, string> = {
  too_expensive: 'está caro', unused: 'não usa o suficiente', missing_features: 'faltou um recurso',
  switched_service: 'foi para outro serviço', too_complex: 'achou complicado',
  low_quality: 'qualidade', customer_service: 'atendimento', other: 'outro motivo',
}
const PLANO: Record<string, string> = { familia: 'Família', plus: 'Família Plus' }

// PostgREST devolve no máximo 1000 linhas por chamada — o mesmo teto mudo que
// já escondeu dados neste projeto. Pagina até o fim.
async function todas<T>(tabela: string, colunas: string): Promise<T[]> {
  const admin = createAdminClient()
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from(tabela).select(colunas).range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.code}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

async function todosUsuarios() {
  const admin = createAdminClient()
  const out: { id: string; email: string; criado: string; ultimoAcesso: string | null; confirmado: boolean }[] = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('auth.users')
    for (const u of data.users) {
      out.push({ id: u.id, email: u.email ?? '', criado: u.created_at, ultimoAcesso: u.last_sign_in_at ?? null, confirmado: !!u.email_confirmed_at })
    }
    if (data.users.length < 1000) break
  }
  return out
}

const idDe = (c: string | Stripe.Customer | Stripe.DeletedCustomer) => (typeof c === 'string' ? c : c.id)
function clienteVivo(c: string | Stripe.Customer | Stripe.DeletedCustomer): Stripe.Customer | null {
  return typeof c === 'string' || ('deleted' in c && c.deleted) ? null : (c as Stripe.Customer)
}
const iso = (segundos: number | null | undefined) => (segundos ? new Date(segundos * 1000).toISOString() : null)

export async function montarPainel(): Promise<PainelNegocio> {
  const admin = createAdminClient()
  const avisos: string[] = []
  const agora = Date.now()

  type Perfil = { user_id: string; full_name: string | null; phone: string | null; acquisition_source: string | null; profile_completed_at: string | null; signup_attribution: Record<string, unknown> | null }
  type Sub = { user_id: string; plan: string | null; status: string | null; trial_ends_at: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null }
  type Membro = { user_id: string; role: string | null }
  type Uso = { user_id: string; filhos: number; atividades: number; usou_ia: boolean }

  const [usuarios, perfis, subs, membros, lembretes, usoRes, vagasRes] = await Promise.all([
    todosUsuarios(),
    todas<Perfil>('profiles', 'user_id, full_name, phone, acquisition_source, profile_completed_at, signup_attribution'),
    todas<Sub>('subscriptions', 'user_id, plan, status, trial_ends_at, stripe_customer_id, stripe_subscription_id'),
    todas<Membro>('family_members', 'user_id, role'),
    todas<{ user_id: string; enviado_em: string }>('cadastro_lembretes', 'user_id, enviado_em'),
    admin.rpc('admin_uso_por_usuario'),
    admin.rpc('vagas_lancamento_usadas'),
  ])
  if (usoRes.error) avisos.push('Não consegui ler as contagens de uso.')
  if (!process.env.RESEND_API_KEY) avisos.push('O lembrete por e-mail de cadastro incompleto está parado: falta a chave RESEND_API_KEY na Vercel.')
  const lembreteDe = new Map(lembretes.map(l => [l.user_id, l.enviado_em]))

  const perfilDe = new Map(perfis.map(p => [p.user_id, p]))
  const subDe = new Map(subs.map(s => [s.user_id, s]))
  const usoDe = new Map(((usoRes.data ?? []) as Uso[]).map(u => [u.user_id, u]))
  const donos = new Set(membros.filter(m => m.role === 'owner').map(m => m.user_id))
  const convidados = new Set(membros.filter(m => m.role !== 'owner' && !donos.has(m.user_id)).map(m => m.user_id))
  const usuarioDe = new Map(usuarios.map(u => [u.id, u]))

  // ── Stripe: assinaturas (todas), para pagantes, receita e cancelamentos ──
  let stripeSubs: Stripe.Subscription[] = []
  const clientesReembolsados = new Set<string>()
  try {
    stripeSubs = await stripe.subscriptions
      .list({ status: 'all', limit: 100, expand: ['data.customer'] })
      .autoPagingToArray({ limit: 2000 })
    const cobrancas = await stripe.charges.list({ limit: 100 }).autoPagingToArray({ limit: 1000 })
    for (const c of cobrancas) {
      if (c.amount_refunded > 0 && c.customer) clientesReembolsados.add(idDe(c.customer))
    }
  } catch {
    avisos.push('Não consegui consultar o Stripe agora: assinantes, receita e cancelamentos podem estar incompletos.')
  }

  const quem = (s: Stripe.Subscription) => {
    const u = usuarioDe.get(s.metadata?.user_id ?? '')
    const c = clienteVivo(s.customer)
    const p = u ? perfilDe.get(u.id) : undefined
    return {
      userId: u?.id ?? null,
      nome: p?.full_name || c?.name || '(conta excluída)',
      email: u?.email || c?.email || '',
    }
  }
  const descreve = (s: Stripe.Subscription) => {
    const item = s.items.data[0]
    const info = item?.price ? planoDoPreco(item.price) : null
    const anual = (info?.interval ?? item?.price?.recurring?.interval) === 'year'
    return {
      item,
      chave: info?.plan ?? null,
      plano: PLANO[info?.plan ?? ''] ?? 'Plano',
      periodo: (anual ? 'Anual' : 'Mensal') as 'Anual' | 'Mensal',
      centavos: item?.price?.unit_amount ?? 0,
      lancamento: ehPrecoLancamento(item?.price),
    }
  }

  const pagas = stripeSubs.filter(s => s.status === 'active' || s.status === 'past_due')
  const canceladas = stripeSubs.filter(s => s.status === 'canceled')
  const jaAssinaram = stripeSubs.filter(s => s.status !== 'incomplete' && s.status !== 'incomplete_expired' && s.status !== 'trialing')

  const assinantes: LinhaAssinante[] = pagas
    .map(s => {
      const d = descreve(s), q = quem(s)
      const fimPeriodo = (d.item as unknown as { current_period_end?: number } | undefined)?.current_period_end
      return {
        nome: q.nome, email: q.email, plano: d.plano, lancamento: d.lancamento, periodo: d.periodo,
        centavos: d.centavos, cancelaNoFim: s.cancel_at_period_end,
        proximaCobranca: s.cancel_at_period_end ? null : iso(fimPeriodo),
        desde: iso(s.start_date) as string,
      }
    })
    .sort((a, b) => b.desde.localeCompare(a.desde))

  const receitaMensalCentavos = pagas
    .filter(s => !s.cancel_at_period_end)
    .reduce((soma, s) => { const d = descreve(s); return soma + (d.periodo === 'Anual' ? Math.round(d.centavos / 12) : d.centavos) }, 0)

  const clientesPagantes = new Set(pagas.map(s => idDe(s.customer)))
  const cancelamentos: LinhaCancelamento[] = canceladas
    .map(s => {
      const d = descreve(s), q = quem(s)
      const fim = s.ended_at ?? s.canceled_at ?? s.start_date
      const fb = s.cancellation_details?.feedback ?? null
      return {
        nome: q.nome, plano: `${d.plano} ${d.periodo.toLowerCase()}`,
        canceladoEm: iso(fim) as string,
        dias: Math.max(0, Math.round((fim - s.start_date) / 86_400)),
        motivo: fb ? (MOTIVOS[fb] ?? fb) : null,
        comentario: s.cancellation_details?.comment ?? null,
        reembolsado: clientesReembolsados.has(idDe(s.customer)),
      }
    })
    .sort((a, b) => b.canceladoEm.localeCompare(a.canceladoEm))
  const cancelaram = new Set(canceladas.map(s => idDe(s.customer)).filter(c => !clientesPagantes.has(c))).size

  // ── Em relação aos 14 dias de teste ───────────────────────────────────
  // O marco é a criação da conta (quando o teste começa). Se a conta já foi
  // excluída, o melhor substituto é a criação do cliente no Stripe.
  const inicioDe = (s: Stripe.Subscription): number => {
    const u = usuarioDe.get(s.metadata?.user_id ?? '')
    if (u) return new Date(u.criado).getTime()
    const c = clienteVivo(s.customer)
    return ((c?.created ?? s.start_date) as number) * 1000
  }
  const retencao = { cancelouNoTeste: 0, ficouGratis: 0, pagandoApos: 0, cancelouApos: 0 }
  const jaContado = new Set<string>()
  // Quem cancelou e não paga hoje: uma vez por cliente, pelo cancelamento mais recente.
  for (const s of [...canceladas].sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0))) {
    const cli = idDe(s.customer)
    if (clientesPagantes.has(cli) || jaContado.has(cli)) continue
    jaContado.add(cli)
    const fim = ((s.ended_at ?? s.canceled_at ?? s.start_date) as number) * 1000
    if (fim - inicioDe(s) <= DIAS_TESTE * DIA) retencao.cancelouNoTeste++
    else retencao.cancelouApos++
  }
  const pagantesContados = new Set<string>()
  let pagantesFamilia = 0, pagantesPlus = 0
  const inicioDosPagantes: number[] = []
  for (const s of pagas) {
    const cli = idDe(s.customer)
    if (pagantesContados.has(cli)) continue
    pagantesContados.add(cli)
    if (descreve(s).chave === 'plus') pagantesPlus++; else pagantesFamilia++
    inicioDosPagantes.push(s.start_date * 1000)
    if (agora - inicioDe(s) > DIAS_TESTE * DIA) retencao.pagandoApos++
  }
  const usuariosQueCancelaram = new Set(canceladas.map(s => s.metadata?.user_id).filter(Boolean) as string[])
  const usuariosPagantes = new Set(pagas.map(s => s.metadata?.user_id).filter(Boolean) as string[])

  // ── Situação de cada cadastro ─────────────────────────────────────────
  const usuariosQueAssinaram = new Set(jaAssinaram.map(s => s.metadata?.user_id).filter(Boolean) as string[])
  const emTeste: LinhaTeste[] = []
  const listaIncompletos: LinhaIncompleto[] = []
  const cadastrosEm: number[] = []
  let gratuito = 0, cortesia = 0, incompletos = 0, nConvidados = 0, concluiram = 0, comFilho = 0, usaramIa = 0
  const porOrigem = new Map<string, LinhaOrigem>()
  const porCampanha = new Map<string, LinhaOrigem>()
  const soma = (mapa: Map<string, LinhaOrigem>, chave: string, assinou: boolean) => {
    const l = mapa.get(chave) ?? { origem: chave, cadastros: 0, assinaram: 0 }
    l.cadastros++; if (assinou) l.assinaram++
    mapa.set(chave, l)
  }

  for (const u of usuarios) {
    const p = perfilDe.get(u.id), s = subDe.get(u.id), uso = usoDe.get(u.id)
    if (p?.profile_completed_at) concluiram++
    if ((uso?.filhos ?? 0) > 0) comFilho++
    if (uso?.usou_ia) usaramIa++

    const assinou = usuariosQueAssinaram.has(u.id)
    const ehConvidado = convidados.has(u.id)
    if (!ehConvidado) {
      soma(porOrigem, p?.acquisition_source || 'Não informou', assinou)
      const utm = p?.signup_attribution?.utm_source
      if (typeof utm === 'string' && utm) {
        const camp = p?.signup_attribution?.utm_campaign
        soma(porCampanha, typeof camp === 'string' && camp ? `${utm} · ${camp}` : utm, assinou)
      }
    }

    const fimTeste = s?.trial_ends_at ? new Date(s.trial_ends_at).getTime() : 0
    if (ehConvidado) nConvidados++
    else if (!p?.profile_completed_at) {
      incompletos++
      listaIncompletos.push({
        email: u.email, criadoEm: u.criado, emailConfirmado: u.confirmado,
        fimDoTeste: s?.status === 'trialing' && fimTeste > agora ? s.trial_ends_at : null,
        ultimoAcesso: u.ultimoAcesso, lembreteEm: lembreteDe.get(u.id) ?? null,
      })
    }
    else if (s?.status === 'trialing' && fimTeste > agora) {
      emTeste.push({
        nome: p.full_name || '—', email: u.email, celular: p.phone,
        fimDoTeste: s.trial_ends_at as string,
        diasRestantes: Math.max(0, Math.ceil((fimTeste - agora) / DIA)),
        deixouCartao: !!s.stripe_subscription_id,
        origem: p.acquisition_source || 'Não informou',
        filhos: uso?.filhos ?? 0, atividades: uso?.atividades ?? 0, ultimoAcesso: u.ultimoAcesso,
      })
    } else if (s?.status === 'active' && s.plan && s.plan !== 'free') {
      if (!s.stripe_customer_id) cortesia++
    } else {
      gratuito++
      // Passou dos 14 dias, nunca cancelou nada e não paga: ficou no gratuito.
      const idade = agora - new Date(u.criado).getTime()
      if (idade > DIAS_TESTE * DIA && !usuariosQueCancelaram.has(u.id) && !usuariosPagantes.has(u.id)) retencao.ficouGratis++
    }
    if (!ehConvidado) cadastrosEm.push(new Date(u.criado).getTime())
  }

  const MES = 30 * DIA
  const faixas: [string, number, number][] = [
    ['Menos de 1 mês', 0, MES], ['De 1 a 3 meses', MES, 3 * MES], ['De 3 a 6 meses', 3 * MES, 6 * MES],
    ['De 6 meses a 1 ano', 6 * MES, 365 * DIA], ['Mais de 1 ano', 365 * DIA, Infinity],
  ]
  const naFaixa = (datas: number[], de: number, ate: number) => datas.filter(d => agora - d >= de && agora - d < ate).length
  const tempoDeBase: LinhaTempo[] = faixas.map(([faixa, de, ate]) => ({
    faixa, cadastros: naFaixa(cadastrosEm, de, ate), pagantes: naFaixa(inicioDosPagantes, de, ate),
  }))
  emTeste.sort((a, b) => a.fimDoTeste.localeCompare(b.fimDoTeste))
  listaIncompletos.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
  const ordena = (m: Map<string, LinhaOrigem>) => [...m.values()].sort((a, b) => b.cadastros - a.cadastros)

  return {
    resumo: {
      cadastros: usuarios.length, emTeste: emTeste.length, assinantes: pagas.length, gratuito, cancelaram,
      receitaMensalCentavos, vagasUsadas: Number(vagasRes.data ?? 0), vagasTotal: VAGAS_LANCAMENTO,
      cortesia, convidados: nConvidados, incompletos, pagantesFamilia, pagantesPlus,
    },
    funil: {
      criaram: usuarios.length, concluiram, comFilho, usaramIa,
      assinaram: new Set(jaAssinaram.map(s => idDe(s.customer))).size,
      cancelaram,
    },
    retencao, tempoDeBase,
    emTeste, incompletos: listaIncompletos, assinantes, cancelamentos, origem: ordena(porOrigem), campanhas: ordena(porCampanha), avisos,
  }
}
