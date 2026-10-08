import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import CompletarCadastroClient from './CompletarCadastroClient'
import { concluirCadastroPelosMetadados, conviteGuardado } from '@/lib/cadastro'

export default async function CompletarCadastroPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Já completou → vai para o app.
  const { data: prof } = await supabase
    .from('profiles')
    .select('profile_completed_at, full_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (prof?.profile_completed_at) redirect('/dashboard')
  // Convite capturado no proxy (cookie). Se existir, ao final do cadastro o
  // usuário é levado para a tela de aceite em vez do dashboard — garantindo
  // que ele entre no ambiente compartilhado, não numa família nova vazia.
  const cookieStore = await cookies()
  const inviteToken = conviteGuardado(cookieStore.get('pending_invite')?.value)

  // Conta criada pela tela atual: os dados já vieram, nada a preencher.
  if (await concluirCadastroPelosMetadados(user)) redirect(inviteToken ? `/convite/${inviteToken}` : '/dashboard')

  // Pré-preenche o nome a partir do cadastro inicial, se houver.
  const initialName =
    prof?.full_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    ''

  return (
    <CompletarCadastroClient
      email={user.email ?? ''}
      initialName={initialName}
      inviteToken={inviteToken}
    />
  )
}
