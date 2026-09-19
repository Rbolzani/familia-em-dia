// Converte uma imagem para JPEG — o caminho de resgate do HEIC do iPhone.
//
// POR QUE NO SERVIDOR
// O navegador converte sozinho (canvas) quando CONSEGUE decodificar. O HEIC
// é justamente o que ele não decodifica fora do Safari, e é o formato padrão
// da câmera do iPhone. Sem esta rota, a foto do filho subia em HEIC e o
// avatar aparecia QUEBRADO em Chrome, Edge e Firefox — arquivo salvo, foto
// invisível, nenhum erro em lugar nenhum.
//
// Reaproveita `normalizeImage`, que já era usado pelo OCR e decide pelos
// magic bytes, não pelo que o seletor de arquivos do sistema declara.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeImage } from '@/lib/image'

/** Teto do arquivo aceito. Foto de celular passa longe disso. */
const MAX_BYTES = 25 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Imagem acima de 25 MB' }, { status: 413 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const norm = await normalizeImage(buffer, file.type, file.name)
    if (!norm) {
      return NextResponse.json({ error: 'Formato de imagem não reconhecido' }, { status: 415 })
    }
    return new Response(new Uint8Array(norm.buffer), {
      headers: { 'Content-Type': norm.mediaType, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[images/jpeg] conversão falhou:', e)
    return NextResponse.json({ error: 'Não foi possível converter a imagem' }, { status: 500 })
  }
}
