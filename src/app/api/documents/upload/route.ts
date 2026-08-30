import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, getFamilyStorageUsedBytes, PLAN_LIMITS, formatarBytes } from '@/lib/billing'
import { validarArquivo } from '@/lib/uploadTypes'

// O padrão da Vercel é 10s. O tempo de subida do arquivo pelo usuário conta
// para a duração da função, e um PDF/foto grande em 4G lento passa disso —
// o upload morreria no meio sem mensagem clara.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const form = await req.formData()
  const title       = form.get('title') as string
  const category    = form.get('category') as string
  const child_id    = (form.get('child_id') as string) || null
  const description = (form.get('description') as string) || null
  const expires_at  = (form.get('expires_at') as string) || null
  const doc_number  = (form.get('doc_number') as string) || null
  const issuer      = (form.get('issuer') as string) || null
  const issue_date  = (form.get('issue_date') as string) || null
  const tagsRaw     = (form.get('tags') as string) || ''
  const tags        = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : null
  const ocr_text    = (form.get('ocr_text') as string) || null
  const doc_type    = (form.get('doc_type') as string) || null
  let metadata: Record<string, unknown> = {}
  const metaRaw = form.get('metadata') as string | null
  if (metaRaw) { try { const m = JSON.parse(metaRaw); if (m && typeof m === 'object') metadata = m } catch {} }
  const files       = form.getAll('files') as File[]

  if (!title || !category) {
    return NextResponse.json({ error: 'Título e categoria são obrigatórios' }, { status: 400 })
  }

  // Tipo, tamanho e assinatura — ANTES de criar o documento, senão uma
  // rejeição deixaria a linha órfã para o rollback limpar.
  const tiposPorArquivo = new Map<File, string>()
  for (const file of files) {
    const cabecalho = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const v = validarArquivo(file.name, file.size, cabecalho)
    if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 415 })
    tiposPorArquivo.set(file, v.contentType)
  }

  // Verificar cota de storage antes de qualquer upload
  if (files.length > 0) {
    const plan = await getFamilyPlan()
    const limit = PLAN_LIMITS[plan].storageLimitBytes
    // `getFamilyStorageUsedBytes` devolvia 0 quando a medição falhava, e zero
    // usado significa "cabe tudo" — uma falha momentânea do banco virava
    // permissão de upload ilimitado. Agora falha FECHADO.
    const used = await getFamilyStorageUsedBytes()
    if (used === null) {
      return NextResponse.json(
        { error: 'Não foi possível verificar sua cota de armazenamento. Tente novamente.' },
        { status: 503 }
      )
    }
    const incoming = files.reduce((sum, f) => sum + f.size, 0)
    if (used + incoming > limit) {
      // Quem terminou o trial acima do limite do gratuito cai aqui: mantém
      // tudo o que já subiu (nada apaga arquivo por troca de plano) e só para
      // de subir coisa nova. A mensagem precisa dizer isso, senão a pessoa
      // acha que vai perder o que guardou.
      const excedente = used > limit
      return NextResponse.json(
        { error: excedente
            ? `Você está usando ${formatarBytes(used)}, acima dos ${formatarBytes(limit)} do seu plano. Seus documentos continuam guardados e acessíveis, mas para enviar novos é preciso liberar espaço ou fazer upgrade.`
            : `Espaço insuficiente: você usa ${formatarBytes(used)} de ${formatarBytes(limit)} e este envio tem ${formatarBytes(incoming)}.` },
        { status: 402 }
      )
    }
  }

  // Create document record first. ocr_text + metadata (extraídos no upload pela
  // IA) alimentam a busca via trigger search_tsv; doc_type guarda a natureza.
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .insert({ user_id: user.id, child_id, category, title, description, expires_at,
              doc_number, issuer, issue_date, tags, ocr_text, doc_type, metadata })
    .select()
    .single()

  if (docErr) {
    console.error('[documents/upload] documento', docErr)
    return NextResponse.json({ error: 'Não foi possível criar o documento.' }, { status: 500 })
  }

  // Upload files to Storage
  const uploadedFiles = []
  for (const file of files) {
    const ext = file.name.split('.').pop() ?? 'bin'
    const rand = Math.random().toString(36).slice(2, 6)
    const storagePath = `${user.id}/${doc.id}/${Date.now()}-${rand}.${ext}`

    const bytes = await file.arrayBuffer()
    // `contentType` sai da NOSSA tabela, não de `file.type`. O tipo enviado
    // pelo cliente foi o que deixou entrar `text/html` no teste O6, e é ele
    // que o Storage devolve ao servir o arquivo depois.
    const contentType = tiposPorArquivo.get(file) ?? 'application/octet-stream'
    const { error: storageErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType, upsert: false })

    if (storageErr) {
      // rollback document
      await supabase.from('documents').delete().eq('id', doc.id)
      console.error('[documents/upload] storage', storageErr)
      return NextResponse.json({ error: 'Falha no upload do arquivo.' }, { status: 500 })
    }

    const { data: fileRec, error: fileErr } = await supabase
      .from('document_files')
      .insert({
        document_id: doc.id,
        user_id: user.id,
        file_name: file.name,
        file_size: file.size,
        mime_type: contentType,
        storage_path: storagePath,
      })
      .select()
      .single()

    if (fileErr) {
      await supabase.from('documents').delete().eq('id', doc.id)
      console.error('[documents/upload] document_files', fileErr)
      return NextResponse.json({ error: 'Falha ao registrar o arquivo.' }, { status: 500 })
    }
    uploadedFiles.push(fileRec)
  }

  return NextResponse.json({ document: doc, files: uploadedFiles })
}
