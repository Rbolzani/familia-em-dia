// Server-only: exclusão de conta — usada pela própria pessoa (/api/account/delete)
// e pela exclusão automática da conta pausada há 90 dias (oferta de 20/10/2026,
// Termos 5.9). O mesmo caminho para as duas: cobrança encerrada no Stripe
// antes, banco limpo pela função `excluir_conta`, arquivos e login apagados,
// registro anônimo para o Painel.
import { createAdminClient } from '@/lib/supabase/server'
import { buscarTodas } from '@/lib/paginacao'
import { stripe } from '@/lib/stripe'

/**
 * Cancela a cobrança do usuário no Stripe, na hora e sem reembolso de período
 * já pago (Termos 5.13, desde 20/10/2026 — antes devolvia dentro de 7 dias).
 *
 * O cliente do Stripe NÃO é apagado: as faturas já pagas precisam continuar
 * existindo (obrigação fiscal e prova para as duas partes). Sem assinatura
 * ativa, um cliente parado não gera cobrança nenhuma.
 */
export async function encerrarCobranca(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  const { data: row } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()

  const customerId = row?.stripe_customer_id as string | null | undefined
  if (!customerId) return   // nunca assinou: nada a encerrar

  const listas = await Promise.all(['active', 'trialing', 'past_due', 'unpaid'].map(st =>
    stripe.subscriptions.list({ customer: customerId, status: st as 'active', limit: 20 })))
  const vivas = listas.flatMap(l => l.data)
  if (vivas.length === 0) return

  for (const s of vivas) {
    // Com `subscription_schedule` o Stripe recusa cancelar direto; soltar o
    // schedule primeiro é o que destrava (ver achado 23).
    const sched = (s as unknown as { schedule?: string | { id: string } }).schedule
    const schedId = typeof sched === 'string' ? sched : sched?.id
    if (schedId) {
      await stripe.subscriptionSchedules.release(schedId)
        .catch(e => console.error('[delete-account] release do schedule falhou:', e))
    }
    await stripe.subscriptions.cancel(s.id)
  }
  console.warn('[delete-account] %d assinatura(s) canceladas no Stripe', vivas.length)
}

/**
 * O que o Painel do negócio guarda de uma conta excluída: só números, nada que
 * identifique a pessoa (ver MIGRATION_contas_excluidas.sql). Lido ANTES da
 * limpeza — depois dela não sobra de onde tirar.
 */
export async function retratoDaConta(admin: ReturnType<typeof createAdminClient>, userId: string, criadaEm: string) {
  const [{ data: sub }, { data: perfil }, { count: filhos }, { data: papeis }] = await Promise.all([
    admin.from('subscriptions').select('plan, status, trial_ends_at, stripe_customer_id').eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('acquisition_source').eq('user_id', userId).maybeSingle(),
    admin.from('children').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin.from('family_members').select('role').eq('user_id', userId),
  ])
  const pago = (sub?.status === 'active' || sub?.status === 'past_due') && !!sub.plan && sub.plan !== 'free'
  const emTeste = sub?.status === 'trialing' && !!sub.trial_ends_at && new Date(sub.trial_ends_at as string).getTime() > Date.now()
  const pausada = sub?.status === 'paused'
  const incompleto = sub?.status === 'incompleto'
  const lista = papeis ?? []
  return {
    dias_de_conta: Math.max(0, Math.floor((Date.now() - new Date(criadaEm).getTime()) / 86_400_000)),
    situacao: pago ? (sub?.stripe_customer_id ? 'pagante' : 'cortesia') : emTeste ? 'teste' : pausada ? 'pausada' : incompleto ? 'incompleto' : 'gratuito',
    tinha_filho: (filhos ?? 0) > 0,
    convidado: lista.length > 0 && !lista.some(p => p.role === 'owner'),
    origem: (perfil?.acquisition_source as string | null | undefined) ?? null,
  }
}


/**
 * Apaga a conta inteira. `ok: false, motivo: 'stripe'` = o Stripe não respondeu
 * e NADA foi apagado (apagar deixando a cobrança de pé seria irreversível).
 * Lança erro em falha de banco/login depois que a limpeza começou.
 */
export async function excluirConta(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  criadaEm: string,
): Promise<{ ok: true } | { ok: false; motivo: 'stripe' }> {
    // Falhar ao montar o retrato não pode impedir a exclusão: é só estatística.
    const retrato = await retratoDaConta(admin, userId, criadaEm).catch(() => null)

    // 3. Coletar caminhos de Storage ANTES da limpeza (famílias solo apenas)
    const { data: myFamilies } = await admin
      .from('families')
      .select('id')
      .eq('created_by', userId)

    const myFamilyIds = (myFamilies ?? []).map(f => f.id as string)
    let storagePathsToDelete: string[] = []
    const avatarPathsToDelete: string[] = []

    if (myFamilyIds.length > 0) {
      const { data: otherMembers } = await admin
        .from('family_members')
        .select('family_id')
        .in('family_id', myFamilyIds)
        .neq('user_id', userId)

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

    // 3b. Encerrar a cobrança NO STRIPE — antes de apagar o banco.
    //
    // ⚠️ POR QUE AQUI, E POR QUE ABORTA SE FALHAR
    // A exclusão apagava banco e arquivos e NUNCA falava com o Stripe. A
    // assinatura seguia viva: quem apagou a conta era cobrado no próximo
    // ciclo, sem app para cancelar e sem login para reclamar — descobria pela
    // fatura do cartão. Cobrança indevida, e contra o direito de
    // arrependimento que o próprio app implementa.
    //
    // O id do cliente vive em `subscriptions`, que o passo 4 apaga: depois
    // dele não há mais como achar a assinatura. Por isso vem antes.
    //
    // Se o Stripe não responder, a exclusão PARA. Apagar a conta deixando a
    // cobrança de pé é irreversível para a pessoa; adiar alguns minutos, não.
    try {
      await encerrarCobranca(admin, userId)
    } catch (e) {
      console.error('[delete-account] falha ao encerrar cobrança no Stripe:', e)
      return { ok: false, motivo: 'stripe' }
    }

    // 4. Limpeza do banco (excluir_conta: mesmo corpo de delete_my_account,
    //    chamável só pelo service_role).
    const { error: rpcErr } = await admin.rpc('excluir_conta', { p_uid: userId })
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
    const { error: authErr } = await admin.auth.admin.deleteUser(userId)
    if (authErr) {
      console.error('[delete-account] auth delete error:', authErr)
      throw new Error(authErr.message)
    }

    // 7. Registro anônimo para o Painel do negócio (melhor esforço).
    if (retrato) {
      const { error: regErr } = await admin.from('contas_excluidas').insert(retrato)
      if (regErr) console.error('[delete-account] registro da exclusão falhou:', regErr.code)
    }

    return { ok: true }
}
