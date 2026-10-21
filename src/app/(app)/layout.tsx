import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import RealtimeSync from '@/components/layout/RealtimeSync'
import { getAccess, getActiveFamily } from '@/lib/access'
import { AccessProvider } from '@/components/access/AccessContext'
import PartnerBanner from '@/components/access/PartnerBanner'
import TrialBanner from '@/components/billing/TrialBanner'
import GraceBanner from '@/components/billing/GraceBanner'
import { PLAN_LABELS, getEffectiveSubscription, getFamilyPlan, planoQueLibera, type PlanId } from '@/lib/billing'
import CobrancaBanner, { type FaixaCobranca } from '@/components/billing/CobrancaBanner'
import { UpsellProvider } from '@/components/billing/Upsell'
import { NOME_PLANO, valorDaCobranca, type PlanoPago } from '@/lib/planos-oferta'
import { DIAS_CARENCIA_CARTAO } from '@/lib/oferta-v2'
import { signChildAvatars } from '@/lib/avatars'
import { ehFundador } from '@/lib/admin-ids'
import { concluirCadastroPelosMetadados, conviteGuardado } from '@/lib/cadastro'

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })

// Faixa do topo do modelo novo (T8, T9, T15, T16, T17). Fora do componente:
// depende do relógio, e o React pede que o render em si seja puro.
function montarFaixa(eff: Awaited<ReturnType<typeof getEffectiveSubscription>>, plano: PlanoPago, ciclo: 'month' | 'year'): FaixaCobranca | null {
  if (eff.oferta !== 'v2') return null
  const isOwner = eff.isOwner
  if (eff.status === 'paused') {
    return { tipo: 'pausada', motivo: eff.pauseReason === 'pagamento' ? 'pagamento' : 'cancelada', apagarEm: eff.deleteAfter ? dataCurta(eff.deleteAfter) : '', isOwner, dono: eff.ownerName }
  }
  if (eff.status === 'past_due') {
    const base = eff.paymentFailedAt ? new Date(eff.paymentFailedAt).getTime() : Date.now()
    return { tipo: 'atraso', ate: dataCurta(new Date(base + DIAS_CARENCIA_CARTAO * 86_400_000).toISOString()), isOwner }
  }
  if (eff.cancelAtPeriodEnd && (eff.status === 'trialing' || eff.status === 'active')) {
    const ate = eff.status === 'trialing' ? eff.trialEndsAt : eff.currentPeriodEnd
    return { tipo: 'cancelado', noTeste: eff.status === 'trialing', ate: ate ? dataCurta(ate) : '', isOwner }
  }
  if (eff.status === 'trialing' && eff.trialEndsAt) {
    const msLeft = new Date(eff.trialEndsAt).getTime() - Date.now()
    return {
      tipo: 'teste',
      diasRestantes: Math.max(0, Math.ceil(msLeft / 86_400_000)),
      cobrancaEm: dataCurta(eff.trialEndsAt),
      plano: NOME_PLANO[plano],
      valor: valorDaCobranca(plano, ciclo).replace(/ por (mês|ano)$/, ''),
      conhecer: plano === 'plus' ? null : (planoQueLibera(plano) as 'familia' | 'plus'),
      isOwner,
    }
  }
  return null
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Bootstrap: garante que todo usuário autenticado tem uma família com o nome correto.
  // Usuários com auto-confirm não passam por /auth/callback, então criamos aqui.
  // Também corrige o nome se a família foi criada com o nome padrão genérico.
  // Gate de cadastro: nome, celular e aceite dos Termos. Quem criou a conta
  // pela tela atual já informou tudo ali — o perfil é concluído aqui mesmo, no
  // primeiro acesso. Só cai em /completar-cadastro (formulário curto, fora
  // deste grupo, sem loop) a conta antiga que parou no meio.
  if (user) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('profile_completed_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!prof?.profile_completed_at) {
      if (!(await concluirCadastroPelosMetadados(user))) redirect('/completar-cadastro')
      // Chegou por link de convite e acabou de concluir: vai aceitar o convite
      // em vez de cair numa família nova e vazia. (A tela de aceite fica fora
      // deste grupo e apaga o cookie ao aceitar.)
      const convite = conviteGuardado((await cookies()).get('pending_invite')?.value)
      if (convite) redirect(`/convite/${convite}`)
    }
  }

  if (user) {
    const metaFamilyName = (user.user_metadata?.family_name as string | undefined)?.trim()
    const { data: familyId } = await supabase.rpc('auth_family_id')
    if (!familyId) {
      await supabase.rpc('create_my_family', { p_name: metaFamilyName || 'Minha Família' })
    } else if (metaFamilyName && metaFamilyName !== 'Minha Família') {
      // Corrige nome genérico deixado por criação anterior sem metadados
      const { data: fam } = await supabase
        .from('families')
        .select('name, created_by')
        .eq('id', familyId)
        .maybeSingle()
      if (fam?.created_by === user.id && (fam.name === 'Família' || fam.name === 'Minha Família')) {
        await supabase.from('families').update({ name: metaFamilyName }).eq('id', familyId)
      }
    }
  }

  // Assinatura efetiva (a do dono da família) e plano da família.
  const [eff, planoFamilia] = user ? await Promise.all([getEffectiveSubscription(), getFamilyPlan()]) : [null, 'free' as PlanId]

  // Modelo novo: quem criou a conta e ainda não cadastrou o cartão só vê
  // "Conclua sua assinatura" (/assinar, fora deste grupo — sem loop).
  if (eff?.oferta === 'v2' && eff.isOwner && eff.status === 'incompleto') redirect('/assinar')

  const plano = (['basico', 'familia', 'plus'].includes(eff?.plan ?? '') ? eff!.plan : 'familia') as PlanoPago
  const ciclo = eff?.billingInterval === 'year' ? 'year' as const : 'month' as const
  const faixa = eff ? montarFaixa(eff, plano, ciclo) : null

  const [{ data: sidebarChildren }, access, { familyId: activeFamilyId }, bannerInfo] = await Promise.all([
    supabase.from('children').select('*').order('sort_order'),
    getAccess(),
    getActiveFamily(supabase),
    (async () => {
      // Faixas do MODELO ANTIGO (teste sem cartão + carência do parceiro).
      if (!user || !eff || eff.oferta === 'v2') return null
      const admin = createAdminClient()

      // Assinatura EFETIVA = a do owner da família. Banner reflete o owner,
      // tanto para o owner quanto para o parceiro (com texto adaptado).
      if (!eff.ownerId) return null

      // ── Trial do owner — vale para owner e parceiro ────────────────────
      if (eff.status === 'trialing' && eff.trialEndsAt) {
        const msLeft   = new Date(eff.trialEndsAt).getTime() - Date.now()
        const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000))

        // Owner: precisa saber se há parceiro (texto sobre desconexão do parceiro)
        let hasPartner = false
        if (eff.isOwner) {
          const { data: familyId } = await supabase.rpc('auth_family_id')
          if (familyId) {
            const { count } = await admin
              .from('family_members')
              .select('id', { count: 'exact', head: true })
              .eq('family_id', familyId)
              .eq('role', 'partner')
            hasPartner = (count ?? 0) > 0
          }
        }

        return {
          type: 'trial' as const,
          daysLeft,
          planLabel: PLAN_LABELS[eff.plan as keyof typeof PLAN_LABELS] ?? eff.plan,
          hasPartner,
          isPartner: !eff.isOwner,
          // Cancelou a assinatura feita no teste: volta a ser um teste comum.
          assinou: eff.assinouNoTeste && !eff.cancelAtPeriodEnd,
          // Fuso de São Paulo: o trial_ends_at fica em UTC, e sem converter a
          // data exibida adianta um dia para quem está no Brasil.
          cobrancaEm: new Date(eff.trialEndsAt).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo',
          }),
        }
      }

      // ── Grace period do owner (trial expirou, parceiro ainda conectado) ─
      if (eff.partnerGraceUntil) {
        const graceEnd = new Date(eff.partnerGraceUntil)
        if (graceEnd > new Date()) {
          const msLeft   = graceEnd.getTime() - Date.now()
          const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000))
          return eff.isOwner
            ? { type: 'owner_grace' as const, daysLeft }
            : { type: 'partner_grace' as const, daysLeft, ownerName: eff.ownerName }
        }
      }

      return null
    })(),
  ])

  // A sidebar mostra o avatar em toda página, então a assinatura acontece aqui
  // uma vez por render do layout — um round-trip para a lista inteira.
  const sidebarChildrenComFoto = await signChildAvatars(supabase, sidebarChildren ?? [])

  return (
      <AccessProvider value={access}>
       <UpsellProvider plano={planoFamilia} ciclo={ciclo} emTeste={eff?.status === 'trialing'} fimTeste={eff?.trialEndsAt ? dataCurta(eff.trialEndsAt) : null} isOwner={eff?.isOwner ?? true}>
        <AppLayout sidebarChildren={sidebarChildrenComFoto} activeFamilyId={activeFamilyId} isAdmin={ehFundador(user?.id)} userId={user?.id ?? ''} plano={planoFamilia}>
          <RealtimeSync />
          <PartnerBanner />
          {faixa && <CobrancaBanner faixa={faixa} />}
          {bannerInfo?.type === 'trial' && (
            <TrialBanner daysLeft={bannerInfo.daysLeft} planLabel={bannerInfo.planLabel} hasPartner={bannerInfo.hasPartner} isPartner={bannerInfo.isPartner} assinou={bannerInfo.assinou} cobrancaEm={bannerInfo.cobrancaEm} />
          )}
          {bannerInfo?.type === 'owner_grace' && (
            <GraceBanner type="owner_grace" daysLeft={bannerInfo.daysLeft} />
          )}
          {bannerInfo?.type === 'partner_grace' && (
            <GraceBanner type="partner_grace" daysLeft={bannerInfo.daysLeft} ownerName={bannerInfo.ownerName} />
          )}
          {children}
        </AppLayout>
       </UpsellProvider>
      </AccessProvider>
  )
}
