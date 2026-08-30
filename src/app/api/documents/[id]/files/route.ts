import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, getFamilyStorageUsedBytes, PLAN_LIMITS } from '@/lib/billing'
import { validarArquivo } from '@/lib/uploadTypes'

// Mesmo motivo do /api/documents/upload: o padrão de 10s da Vercel não cobre
// a subida de um arquivo grande em conexão móvel lenta.
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // RLS escopa por família — full_editor pode anexar a docs do owner
  const { data: doc } = await supabase
    .from('documents')
    .select('id')
    .eq('id', id)
    .single()
  if (!doc) return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })

  const form = await req.formData()
  const files = form.getAll('files') as File[]
  if (!files.length) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })

  // Mesma validação da rota de criação — este é o segundo caminho de upload,
  // e um allowlist que cobre só um dos dois não vale nada.
  const tiposPorArquivo = new Map<File, string>()
  for (const file of files) {
    const cabecalho = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const v = validarArquivo(file.name, file.size, cabecalho)
    if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 415 })
    tiposPorArquivo.set(file, v.contentType)
  }

  // Verificar cota de storage
  const plan = await getFamilyPlan()
  const limit = PLAN_LIMITS[plan].storageLimitBytes
  if (limit === 0) {
    return NextResponse.json(
      { error: 'Seu plano não inclui armazenamento de arquivos no cofre. Faça upgrade para Família ou Plus.' },
      { status: 402 }
    )
  }
  // Falha ao medir a cota recusa o upload — 0 significaria "cabe tudo".
  const used = await getFamilyStorageUsedBytes()
  if (used === null) {
    return NextResponse.json(
      { error: 'Não foi possível verificar sua cota de armazenamento. Tente novamente.' },
      { status: 503 }
    )
  }
  const incoming = files.reduce((sum, f) => sum + f.size, 0)
  if (used + incoming > limit) {
    return NextResponse.json(
      { error: `Cota de armazenamento atingida. Seu plano permite ${Math.round(limit / (1024 ** 3))} GB e você está usando ${(used / (1024 ** 3)).toFixed(2)} GB.` },
      { status: 402 }
    )
  }

  const uploaded = []
  for (const file of files) {
    const ext = file.name.split('.').pop() ?? 'bin'
    const rand = Math.random().toString(36).slice(2, 6)
    const storagePath = `${user.id}/${id}/${Date.now()}-${rand}.${ext}`

    const bytes = await file.arrayBuffer()
    const contentType = tiposPorArquivo.get(file) ?? 'application/octet-stream'
    const { error: storageErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType, upsert: false })

    if (storageErr) {
      console.error('[documents/files POST]', storageErr)
      return NextResponse.json({ error: 'Falha no upload do arquivo.' }, { status: 500 })
    }

    const { data: fileRec } = await supabase
      .from('document_files')
      .insert({
        document_id: id,
        user_id: user.id,
        file_name: file.name,
        file_size: file.size,
        mime_type: contentType,
        storage_path: storagePath,
      })
      .select()
      .single()

    uploaded.push(fileRec)
  }

  return NextResponse.json({ files: uploaded })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('fileId')
  if (!fileId) return NextResponse.json({ error: 'fileId obrigatório' }, { status: 400 })

  const { data: file } = await supabase
    .from('document_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('document_id', id)
    .single()

  if (!file) return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })

  await supabase.storage.from('documents').remove([file.storage_path])
  await supabase.from('document_files').delete().eq('id', fileId)

  return NextResponse.json({ ok: true })
}
