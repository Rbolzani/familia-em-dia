import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  // 1. Verificar sessão
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Verificar confirmação explícita (LGPD)
  let confirmation: string
  try {
    const body = await request.json()
    confirmation = body.confirmation
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 })
  }
  if (confirmation !== 'EXCLUIR') {
    return NextResponse.json({ error: 'Confirmação inválida' }, { status: 400 })
  }

  const admin = createAdminClient()

  try {
    // 3. Coletar caminhos de Storage ANTES da limpeza (famílias solo apenas)
    const { data: myFamilies } = await admin
      .from('families')
      .select('id')
      .eq('created_by', user.id)

    const myFamilyIds = (myFamilies ?? []).map(f => f.id as string)
    let storagePathsToDelete: string[] = []
    let familiesWithPartners = new Set<string>()

    if (myFamilyIds.length > 0) {
      const { data: otherMembers } = await admin
        .from('family_members')
        .select('family_id')
        .in('family_id', myFamilyIds)
        .neq('user_id', user.id)

      familiesWithPartners = new Set((otherMembers ?? []).map(m => m.family_id as string))
      const soloFamilyIds = myFamilyIds.filter(id => !familiesWithPartners.has(id))

      if (soloFamilyIds.length > 0) {
        const { data: paths } = await admin
          .from('document_files')
          .select('storage_path')
          .in('family_id', soloFamilyIds)
        storagePathsToDelete = (paths ?? []).map(p => p.storage_path as string)
      }
    }

    // 3b. Fotos dos filhos (bucket `avatars`) — LGPD.
    //
    // Este bucket nunca era limpo: a rota só removia do bucket `documents`, e
    // as fotos ficavam para sempre, inclusive de contas já apagadas. Foto de
    // menor retida após pedido de exclusão é o pior caso possível.
    //
    // ⚠️ O caminho aqui é `<user_id_de_quem_subiu>/<arquivo>`, e NÃO
    // `<family_id>/...` como no cofre. Isso impede apagar por família: numa
    // família compartilhada, a foto que o pai subiu é a foto do filho que fica
    // com a mãe — apagá-la destruiria dado de quem permanece.
    //
    // Por isso a regra é conservadora: só limpa quando NENHUMA família do
    // usuário sobrevive à exclusão (nem uma que ele criou e tem parceiro, nem
    // uma em que ele era parceiro). Cobre o caso comum, que é a conta solo.
    // A solução definitiva é indexar o caminho por família, como o cofre faz.
    const { data: partnerOf } = await admin
      .from('family_members')
      .select('family_id')
      .eq('user_id', user.id)

    const sobreviveAlguma =
      familiesWithPartners.size > 0 ||
      (partnerOf ?? []).some(m => !myFamilyIds.includes(m.family_id as string))

    let avatarPathsToDelete: string[] = []
    if (!sobreviveAlguma) {
      const { data: avatarFiles } = await admin.storage.from('avatars').list(user.id)
      avatarPathsToDelete = (avatarFiles ?? [])
        // `list` devolve subpastas como entradas com id nulo; só arquivos têm id.
        .filter(f => f.id !== null)
        .map(f => `${user.id}/${f.name}`)
    }

    // 4. Limpeza do banco via SECURITY DEFINER usando auth.uid() do usuário
    //    (chamado com o client do usuário para que auth.uid() retorne o ID correto)
    const { error: rpcErr } = await supabase.rpc('delete_my_account')
    if (rpcErr) {
      console.error('[delete-account] rpc error:', rpcErr)
      throw new Error(rpcErr.message)
    }

    // 5. Deletar arquivos do Storage (melhor esforço)
    if (storagePathsToDelete.length > 0) {
      const { error: storageErr } = await admin.storage
        .from('documents')
        .remove(storagePathsToDelete)
      if (storageErr) console.error('[delete-account] storage error:', storageErr)
    }
    if (avatarPathsToDelete.length > 0) {
      const { error: avatarErr } = await admin.storage
        .from('avatars')
        .remove(avatarPathsToDelete)
      if (avatarErr) console.error('[delete-account] avatars error:', avatarErr)
    }

    // 6. Deletar auth.users — remove email, senha, telefone, user_metadata
    const { error: authErr } = await admin.auth.admin.deleteUser(user.id)
    if (authErr) {
      console.error('[delete-account] auth delete error:', authErr)
      throw new Error(authErr.message)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[delete-account]', err)
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
