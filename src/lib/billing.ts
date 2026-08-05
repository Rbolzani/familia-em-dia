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
  free:    { children: 2,        aiPerMonth: 5,        partners: 0,        ocr: false, documentSearch: false, storageLimitBytes: 0                  },
  familia: { children: 2,        aiPerMonth: Infinity, partners: 1,        ocr: true,  documentSearch: true,  storageLimitBytes: 500 * 1024 * 1024  },
  plus:    { children: Infinity, aiPerMonth: Infinity, partners: Infinity, ocr: true,  documentSearch: true,  storageLimitBytes: 5 * GB             },
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
export async function getFamilyStorageUsedBytes(): Promise<number> {
  const supabase = await createClient()
  // Soma no banco (RPC). Antes trazia todas as linhas de document_files e
  // somava aqui — o PostgREST corta a resposta em 1000 linhas por padrão, de
  // modo que uma família com mais de 1000 arquivos teria a cota SUBCONTADA e
  // conseguiria ultrapassar o limite do plano sem ser barrada.
  const { data, error } = await supabase.rpc('family_storage_used_bytes')
  if (error) {
    console.error('[billing] family_storage_used_bytes falhou:', error)
    return 0
  }
  return Number(data ?? 0)
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
