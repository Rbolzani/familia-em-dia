import { createClient, createAdminClient } from './supabase/server'

export type PlanId = 'free' | 'familia' | 'plus'

// OCR de documentos (v1b): auto-preenche campos ao escanear + busca full-text
// dentro dos documentos + volume ilimitado. Decisão comercial: o OCR é IDÊNTICO
// no Família e no Plus (não é eixo de upsell); entre os dois pagos, o único
// diferencial pretendido é o storage. O Gratuito não tem OCR dedicado — segue
// o limite de 5 capturas de IA/mês.
const GB = 1024 * 1024 * 1024

export const PLAN_LIMITS: Record<PlanId, {
  children: number
  aiPerMonth: number
  partners: number
  ocr: boolean             // OCR completo (auto-preenchimento + volume ilimitado)
  documentSearch: boolean  // busca full-text dentro dos documentos
  storageLimitBytes: number // 0 = sem upload de arquivos no vault
}> = {
  // Gratuito NÃO envia arquivo novo ao cofre — o envio é do plano pago.
  //
  // ⚠️ Zero aqui bloqueia o ENVIO, nunca o acesso. Ler e baixar não dependem
  // de plano em lugar nenhum (signed-url e a tela de detalhe não checam), e
  // nada apaga arquivo por troca de plano. Quem subiu documentos durante o
  // trial e voltou para o gratuito continua com tudo — só para de subir.
  //
  // Como o limite é zero, "liberar espaço" NÃO resolve para este plano: a
  // mensagem precisa apontar para a assinatura, não para apagar arquivos.
  free:    { children: 2,        aiPerMonth: 5,        partners: 0,        ocr: false, documentSearch: false, storageLimitBytes: 0                  },
  familia: { children: 2,        aiPerMonth: Infinity, partners: 1,        ocr: true,  documentSearch: true,  storageLimitBytes: 500 * 1024 * 1024  },
  plus:    { children: Infinity, aiPerMonth: Infinity, partners: Infinity, ocr: true,  documentSearch: true,  storageLimitBytes: 5 * GB             },
}

/**
 * Bytes em texto legível.
 *
 * As rotas de upload formatavam a cota com `Math.round(limit / 1024**3)`, que
 * só funciona para limites em GB. Com o gratuito em 50 MB isso passou a
 * imprimir "Seu plano permite 0 GB" — mensagem sem sentido justamente para
 * quem mais precisa entender o limite.
 */
export function formatarBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Texto do 402 de cota. Vive aqui porque as DUAS rotas de upload precisam
 * dizer a mesma coisa — e antes cada uma tinha sua própria versão.
 *
 * Os três casos são diferentes de verdade, e a diferença importa:
 *
 *  · limite ZERO e nada guardado → nunca teve cofre; convite direto ao plano.
 *  · limite ZERO com arquivos    → usou o trial e voltou ao gratuito. Precisa
 *    ouvir, antes de qualquer outra coisa, que NÃO vai perder o que guardou.
 *    E "libere espaço" seria mentira: com limite zero, apagar não libera nada.
 *  · limite > 0 estourado        → aí sim liberar espaço resolve.
 */
export function mensagemDeCota(limit: number, used: number, incoming: number): string {
  if (limit === 0) {
    return used > 0
      ? `Seus ${formatarBytes(used)} de documentos continuam guardados e acessíveis. Para enviar novos arquivos, assine o plano Família ou Plus.`
      : 'O envio de arquivos ao cofre faz parte dos planos Família e Plus.'
  }
  return used > limit
    ? `Você está usando ${formatarBytes(used)}, acima dos ${formatarBytes(limit)} do seu plano. Seus documentos continuam guardados e acessíveis, mas para enviar novos é preciso liberar espaço ou fazer upgrade.`
    : `Espaço insuficiente: você usa ${formatarBytes(used)} de ${formatarBytes(limit)} e este envio tem ${formatarBytes(incoming)}.`
}

export const PLAN_LABELS: Record<PlanId, string> = {
  free:    'Gratuito',
  familia: 'Família',
  plus:    'Plus',
}

// Lê o plano da família do usuário autenticado via RPC SECURITY DEFINER.
export async function getFamilyPlan(): Promise<PlanId> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_family_plan')
  return (data as PlanId) ?? 'free'
}

export interface EffectiveSubscription {
  isOwner: boolean
  ownerId: string | null
  ownerName: string | null
  plan: PlanId
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  billingInterval: string | null
  partnerGraceUntil: string | null
}

// Resolve a assinatura "efetiva" do usuário: a do OWNER da família ativa.
// O plano é sempre herdado do owner — então banner de trial, status e tela de
// planos devem refletir a assinatura do owner, não a do parceiro. Para o owner,
// é a própria assinatura.
export async function getEffectiveSubscription(): Promise<EffectiveSubscription> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()

  const empty: EffectiveSubscription = {
    isOwner: true, ownerId: null, ownerName: null,
    plan: 'free', status: 'free', trialEndsAt: null,
    currentPeriodEnd: null, cancelAtPeriodEnd: false,
    billingInterval: null, partnerGraceUntil: null,
  }
  if (!user) return empty

  // Família ativa e seu owner
  const { data: familyId } = await supabase.rpc('auth_family_id')
  let ownerId = user.id
  let ownerName: string | null = null
  if (familyId) {
    const { data: fam } = await supabase
      .from('families')
      .select('created_by, name')
      .eq('id', familyId)
      .maybeSingle()
    if (fam?.created_by) ownerId = fam.created_by
    ownerName = fam?.name ?? null
  }
  const isOwner = ownerId === user.id

  // Assinatura do owner (fonte de verdade do plano para toda a família)
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan, status, trial_ends_at, current_period_end, cancel_at_period_end, billing_interval, partner_grace_until')
    .eq('user_id', ownerId)
    .maybeSingle()

  return {
    isOwner,
    ownerId,
    ownerName,
    plan: (sub?.plan as PlanId) ?? 'free',
    status: sub?.status ?? 'free',
    trialEndsAt: sub?.trial_ends_at ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    billingInterval: sub?.billing_interval ?? null,
    partnerGraceUntil: sub?.partner_grace_until ?? null,
  }
}

// Retorna quantas capturas de IA o usuário já usou no mês corrente.
// Reseta automaticamente se o contador estiver de um mês anterior.
export async function getAiUsageThisMonth(userId: string): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('ai_uses_this_month, ai_uses_reset_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return 0

  const resetAt = new Date(data.ai_uses_reset_at)
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // Contador de mês anterior — considera como zero
  if (resetAt < startOfMonth) return 0
  return data.ai_uses_this_month ?? 0
}

// Soma o total de bytes armazenados no vault da família ativa do usuário logado.
// Usa o cliente com RLS — a query automaticamente retorna só os arquivos da família.
/**
 * Bytes já usados pela família, ou `null` se a medição falhar.
 *
 * ⚠️ O `null` é o ponto. Antes esta função devolvia 0 quando a RPC dava erro —
 * e zero usado significa "cabe tudo", então uma falha momentânea do banco
 * virava permissão de upload sem limite. Quem chama PRECISA tratar o `null`
 * como recusa, não como zero.
 */
export async function getFamilyStorageUsedBytes(): Promise<number | null> {
  const supabase = await createClient()
  // Soma no banco (RPC). Antes trazia todas as linhas de document_files e
  // somava aqui — o PostgREST corta a resposta em 1000 linhas por padrão, de
  // modo que uma família com mais de 1000 arquivos teria a cota SUBCONTADA e
  // conseguiria ultrapassar o limite do plano sem ser barrada.
  const { data, error } = await supabase.rpc('family_storage_used_bytes')
  if (error) {
    console.error('[billing] family_storage_used_bytes falhou:', error)
    return null
  }
  return Number(data ?? 0)
}

/**
 * Teto DIÁRIO de chamadas de IA por usuário, em todas as rotas que custam
 * dinheiro (Anthropic e Groq).
 *
 * 50 é folgado para uso real — uma família não fotografa 50 documentos por
 * dia — e corta o caso que importa: script abusivo ou conta comprometida
 * chamando em laço. O limite mensal por plano (`aiPerMonth`) continua valendo
 * por cima; no pago ele é Infinity, então este era o único teto ausente.
 */
export const AI_CALLS_PER_DAY = 50

export interface CotaDiaria { permitido: boolean; usado: number; limite: number }

/**
 * Consome uma chamada e diz se ela pode prosseguir. ATÔMICO: incrementa e
 * devolve o novo valor numa instrução só, então chamadas paralelas não
 * ultrapassam o teto — problema que `incrementAiUsage` tem por ler e escrever
 * em duas idas ao banco.
 *
 * Falha ao contabilizar PERMITE a chamada: derrubar o recurso do usuário
 * legítimo por indisponibilidade do contador seria pior que o abuso que ele
 * evita. O oposto de `getFamilyStorageUsedBytes`, onde falhar aberto liberava
 * upload ilimitado — aqui o pior caso é uma chamada a mais.
 */
export async function consumirChamadaIa(userId: string): Promise<CotaDiaria> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('consume_ai_call', {
    p_user_id: userId,
    p_daily_limit: AI_CALLS_PER_DAY,
  })
  if (error) {
    console.error('[billing] consume_ai_call falhou:', { code: error.code })
    return { permitido: true, usado: 0, limite: AI_CALLS_PER_DAY }
  }
  return data as CotaDiaria
}

/** Mensagem única do 429, para as três rotas não divergirem. */
export function mensagemLimiteDiario(c: CotaDiaria): string {
  return `Você atingiu o limite de ${c.limite} usos de IA por dia. O contador zera amanhã.`
}

// Incrementa o contador de IA do mês. Reseta se for mês novo.
export async function incrementAiUsage(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('ai_uses_this_month, ai_uses_reset_at')
    .eq('user_id', userId)
    .maybeSingle()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const isNewMonth = !data || new Date(data.ai_uses_reset_at) < startOfMonth
  const newCount = isNewMonth ? 1 : (data.ai_uses_this_month ?? 0) + 1

  await admin.from('subscriptions').upsert({
    user_id: userId,
    ai_uses_this_month: newCount,
    ai_uses_reset_at: isNewMonth ? startOfMonth.toISOString() : undefined,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}
