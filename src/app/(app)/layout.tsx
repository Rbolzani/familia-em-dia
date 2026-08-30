import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import RealtimeSync from '@/components/layout/RealtimeSync'
import { getAccess, getActiveFamily } from '@/lib/access'
import { AccessProvider } from '@/components/access/AccessContext'
import PartnerBanner from '@/components/access/PartnerBanner'
import { TourProvider } from '@/components/tour/TourContext'
import TrialBanner from '@/components/billing/TrialBanner'
import GraceBanner from '@/components/billing/GraceBanner'
import { PLAN_LABELS, getEffectiveSubscription } from '@/lib/billing'
import { signChildAvatars } from '@/lib/avatars'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Bootstrap: garante que todo usuário autenticado tem uma família com o nome correto.
  // Usuários com auto-confirm não passam por /auth/callback, então criamos aqui.
  // Também corrige o nome se a família foi criada com o nome padrão genérico.
  // Gate de cadastro: todo usuário precisa completar os dados pessoais (LGPD/cobrança)
  // antes de entrar no app. A página /completar-cadastro fica fora deste grupo (app),
  // então não há loop de redirect.
  if (user) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('profile_completed_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!prof?.profile_completed_at) redirect('/completar-cadastro')
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

  const [{ data: sidebarChildren }, access, { familyId: activeFamilyId }, bannerInfo] = await Promise.all([
    supabase.from('children').select('*').order('sort_order'),
    getAccess(),
    getActiveFamily(supabase),
    (async () => {
      if (!user) return null
      const admin = createAdminClient()

      // Assinatura EFETIVA = a do owner da família. Banner reflete o owner,
      // tanto para o owner quanto para o parceiro (com texto adaptado).
      const eff = await getEffectiveSubscription()
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

  const hasChildren = (sidebarChildren ?? []).length > 0

  // A sidebar mostra o avatar em toda página, então a assinatura acontece aqui
  // uma vez por render do layout — um round-trip para a lista inteira.
  const sidebarChildrenComFoto = await signChildAvatars(supabase, sidebarChildren ?? [])

  return (
    <TourProvider hasChildren={hasChildren} userId={user?.id ?? ''}>
      <AccessProvider value={access}>
        <AppLayout sidebarChildren={sidebarChildrenComFoto} activeFamilyId={activeFamilyId}>
          <RealtimeSync />
          <PartnerBanner />
          {bannerInfo?.type === 'trial' && (
            <TrialBanner daysLeft={bannerInfo.daysLeft} planLabel={bannerInfo.planLabel} hasPartner={bannerInfo.hasPartner} isPartner={bannerInfo.isPartner} />
          )}
          {bannerInfo?.type === 'owner_grace' && (
            <GraceBanner type="owner_grace" daysLeft={bannerInfo.daysLeft} />
          )}
          {bannerInfo?.type === 'partner_grace' && (
            <GraceBanner type="partner_grace" daysLeft={bannerInfo.daysLeft} ownerName={bannerInfo.ownerName} />
          )}
          {children}
        </AppLayout>
      </AccessProvider>
    </TourProvider>
  )
}
