import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AlertasClient from './AlertasClient'
import { getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'
import { toWhatsAppNumber } from '@/lib/cpf'

export default async function AlertasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: familias } = await supabase.rpc('get_my_families')
  const lista = (familias ?? []) as Array<{ family_id: string; family_name: string; is_active: boolean }>
  const familia = lista.find(f => f.is_active) ?? lista[0] ?? null

  const [{ data: waSettings }, { data: escolha }, { data: prof }, plan] = await Promise.all([
    supabase
      .from('notification_settings')
      .select('whatsapp_number, daily_summary_enabled, summary_time')
      .eq('user_id', user.id)
      .maybeSingle(),
    // Horário e liga/desliga são por família; sem escolha feita, vale o padrão da pessoa.
    supabase
      .from('resumo_familia')
      .select('enabled, summary_time')
      .eq('user_id', user.id)
      .eq('family_id', familia?.family_id ?? '')
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('phone')
      .eq('user_id', user.id)
      .maybeSingle(),
    getFamilyPlan(),
  ])

  const twilioMode    = !!process.env.TWILIO_ACCOUNT_SID
  const twilioKeyword = process.env.TWILIO_SANDBOX_KEYWORD ?? ''

  // Número: usa o salvo em /alertas; se vazio, pré-preenche com o celular do
  // cadastro (formato de WhatsApp). Marca se veio do cadastro para exibir aviso.
  const savedNumber = waSettings?.whatsapp_number ?? ''
  const cadastroNumber = toWhatsAppNumber(prof?.phone) ?? ''
  const number = savedNumber || cadastroNumber
  const prefilledFromCadastro = !savedNumber && !!cadastroNumber

  return (
    <AlertasClient
      // Trocar de família no seletor recomeça a tela com a configuração da nova.
      key={familia?.family_id ?? 'sem-familia'}
      userId={user.id}
      userEmail={user.email ?? ''}
      familyId={familia?.family_id ?? null}
      familyName={lista.length > 1 ? familia?.family_name ?? null : null}
      whatsapp={{
        number,
        enabled: escolha?.enabled ?? waSettings?.daily_summary_enabled ?? false,
        time: (escolha?.summary_time ?? waSettings?.summary_time ?? '07:00').slice(0, 5),
      }}
      prefilledFromCadastro={prefilledFromCadastro}
      twilioMode={twilioMode}
      twilioKeyword={twilioKeyword}
      whatsappBlocked={!PLAN_LIMITS[plan].whatsapp}
    />
  )
}
