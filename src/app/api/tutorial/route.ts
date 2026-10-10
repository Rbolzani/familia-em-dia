import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan } from '@/lib/billing'

// Estado do tutorial "Primeiros passos": plano da família (para o aviso de
// recurso pago) e quais passos a pessoa já fez. Só é chamado quando o tutorial
// abre, para não pesar no carregamento de cada página. As consultas passam
// pela RLS: contam apenas dados da família ativa.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existe = async (q: PromiseLike<{ count: number | null }>) => ((await q).count ?? 0) > 0
  const atividades = () => supabase.from('activities').select('id', { count: 'exact', head: true })

  const [plano, filhos, alerta, parceiros, convites, ia, escola, logistica, documentos, mensalidades] = await Promise.all([
    getFamilyPlan(),
    existe(supabase.from('children').select('id', { count: 'exact', head: true })),
    supabase.from('notification_settings').select('whatsapp_number, daily_summary_enabled').eq('user_id', user.id).maybeSingle(),
    existe(supabase.from('family_members').select('id', { count: 'exact', head: true }).eq('role', 'partner')),
    existe(supabase.from('family_invites').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    existe(atividades().eq('ai_generated', true)),
    existe(atividades().eq('category', 'escola')),
    existe(atividades().or('takes_user_id.not.is.null,picks_user_id.not.is.null')),
    existe(supabase.from('documents').select('id', { count: 'exact', head: true })),
    existe(supabase.from('payments').select('id', { count: 'exact', head: true })),
  ])

  return NextResponse.json({
    gratuito: plano === 'free',
    feitos: {
      filhos,
      alertas: !!alerta.data?.daily_summary_enabled && !!alerta.data?.whatsapp_number,
      compartilhar: parceiros || convites,
      ia,
      escola,
      logistica,
      documentos,
      mensalidades,
    },
  })
}
