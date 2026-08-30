import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buscarTodas } from '@/lib/paginacao'

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
    const avatarPathsToDelete: string[] = []

    if (myFamilyIds.length > 0) {
      const { data: otherMembers } = await admin
        .from('family_members')
        .select('family_id')
        .in('family_id', myFamilyIds)
        .neq('user_id', user.id)

      const familiesWithPartners = new Set((otherMembers ?? []).map(m => m.family_id as string))
      // Só as famílias que morrem com a conta. Onde há parceiro, a família
      // sobrevive e os arquivos são dele também — apagar destruiria dado alheio.
      const soloFamilyIds = myFamilyIds.filter(id => !familiesWithPartners.has(id))

      if (soloFamilyIds.length > 0) {
        // Paginado: o PostgREST corta em 1000 linhas sem erro. Acima disso, o
        // excedente ficaria no bucket depois de a conta ter sido apagada — o
        // mesmo problema de LGPD que já corrigimos por outro caminho (o
        // bucket de avatares nunca era limpo).
        const paths = await buscarTodas<{ storage_path: string }>((de, ate) => admin
          .from('document_files')
          .select('storage_path')
          .in('family_id', soloFamilyIds)
          .range(de, ate))
        storagePathsToDelete = paths.map(p => p.storage_path)

        // Fotos dos filhos (LGPD). Este bucket nunca era limpo — as fotos
        // ficavam para sempre, inclusive de contas já apagadas.
        // Desde que o caminho passou a ser `<family_id>/<child_id>.<ext>`, a
        // regra é idêntica à dos documentos: a foto pertence à família, então
        // some junto com ela.
        for (const famId of soloFamilyIds) {
          const { data: files } = await admin.storage.from('avatars').list(famId)
          avatarPathsToDelete.push(
            // `list` devolve subpastas como entradas de id nulo; só arquivos têm id.
            ...(files ?? []).filter(f => f.id !== null).map(f => `${famId}/${f.name}`),
          )
        }
      }
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
