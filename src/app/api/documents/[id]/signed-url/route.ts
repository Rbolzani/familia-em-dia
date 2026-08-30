import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('fileId')
  if (!fileId) return NextResponse.json({ error: 'fileId obrigatório' }, { status: 400 })

  // RLS escopa por família — partner pode baixar arquivos do owner
  const { data: file } = await supabase
    .from('document_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('document_id', id)
    .single()

  if (!file) return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })

  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(file.storage_path, 3600)

  if (error) {
    console.error('[signed-url]', error)
    return NextResponse.json({ error: 'Não foi possível gerar o link do arquivo.' }, { status: 500 })
  }
  return NextResponse.json({ url: data.signedUrl })
}
