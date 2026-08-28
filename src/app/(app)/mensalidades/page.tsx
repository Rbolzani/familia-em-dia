import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MensalidadesClient from './MensalidadesClient'

export default async function MensalidadesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // As marcas de pagamento são poucas por natureza (uma por mensalidade por
  // mês pago), então vêm todas de uma vez — assim navegar entre meses no
  // cliente não dispara consulta nova. A RLS já limita ao escopo da família.
  const [{ data: payments }, { data: marks }, { data: children }] = await Promise.all([
    supabase.from('payments')
      .select('*, child:children(name, avatar_color)')
      .order('due_day'),
    supabase.from('payment_marks').select('*'),
    supabase.from('children').select('*').order('sort_order'),
  ])

  return (
    <MensalidadesClient
      initialPayments={(payments ?? []) as Parameters<typeof MensalidadesClient>[0]['initialPayments']}
      initialMarks={(marks ?? []) as Parameters<typeof MensalidadesClient>[0]['initialMarks']}
      children={(children ?? []) as Parameters<typeof MensalidadesClient>[0]['children']}
    />
  )
}
