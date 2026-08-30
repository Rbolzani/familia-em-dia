import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Edição dos dados cadastrais do documento. RLS garante que só owner/full_editor
// da mesma família consegue atualizar. O trigger search_tsv reindexa sozinho.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'Título é obrigatório' }, { status: 400 })

  const tags = Array.isArray(body.tags)
    ? body.tags
    : (typeof body.tags === 'string' && body.tags.trim()
        ? body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : null)

  const update: Record<string, unknown> = {
    title,
    description: body.description?.trim() || null,
    child_id:   body.child_id || null,
    category:   body.category,
    expires_at: body.expires_at || null,
    doc_number: body.doc_number?.trim() || null,
    issuer:     body.issuer?.trim() || null,
    issue_date: body.issue_date || null,
    tags,
  }
  // Natureza + campos específicos (v1c) — só sobrescreve se enviados.
  if ('doc_type' in body) update.doc_type = body.doc_type || null
  if (body.metadata && typeof body.metadata === 'object') update.metadata = body.metadata

  // `maybeSingle` em vez de `single`: quando a RLS esconde a linha, o UPDATE
  // atinge zero linhas. Com `single` isso virava erro do PostgREST, devolvido
  // como 500 com a mensagem interna dele repassada ao cliente — status errado
  // (não é falha do servidor) e vazamento de detalhe de implementação.
  // Comprovado no teste de IDOR: editar documento de outra família dava 500.
  const { data, error } = await supabase
    .from('documents')
    .update(update)
    .eq('id', id)
    .select('*, child:children(id,name,avatar_color)')
    .maybeSingle()

  if (error) {
    console.error('[documents PATCH]', error)
    return NextResponse.json({ error: 'Não foi possível salvar o documento.' }, { status: 500 })
  }
  // Sem linha = não existe OU não é da sua família. A resposta é a mesma de
  // propósito: distinguir os dois casos confirmaria a existência do documento
  // alheio a quem não pode vê-lo.
  if (!data) return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })

  return NextResponse.json({ document: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Fetch all files to delete from storage (RLS escopa por família)
  const { data: files } = await supabase
    .from('document_files')
    .select('storage_path')
    .eq('document_id', id)

  if (files?.length) {
    await supabase.storage.from('documents').remove(files.map(f => f.storage_path))
  }

  // RLS permite delete apenas a owner/full_editor da mesma família.
  //
  // `.select('id')` no DELETE é o que torna o resultado verificável: sem ele,
  // um delete barrado pela RLS remove ZERO linhas e NÃO gera erro — a rota
  // respondia `{ok:true}` sem ter apagado nada. Um parceiro read_only veria
  // "excluído com sucesso" e o item voltaria ao recarregar.
  const { data: removidos, error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    console.error('[documents DELETE]', error)
    return NextResponse.json({ error: 'Não foi possível excluir o documento.' }, { status: 500 })
  }
  if (!removidos || removidos.length === 0) {
    return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
