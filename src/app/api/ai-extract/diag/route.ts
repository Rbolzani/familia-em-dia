import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Diagnóstico de falha da Captura por IA vista PELO NAVEGADOR.
//
// Quando a chamada falha do lado do celular ("Failed to fetch"), o servidor
// não fica sabendo: a rota principal registra 200 e a pessoa vê erro. Aqui o
// navegador conta o que viu (em que fase, depois de quanto tempo, tamanho da
// foto) e isso vai para os logs da Vercel. Não recebe conteúdo da foto nem
// texto digitado: só números e rótulos curtos.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })

  const bruto = (await req.text()).slice(0, 2000)
  let d: Record<string, unknown> = {}
  try { d = JSON.parse(bruto) } catch { /* corpo inválido: registra vazio */ }
  const curto = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 160)
  console.error('[ai-extract][navegador]', JSON.stringify({
    usuario: user.id.slice(0, 8),
    fase: curto(d.fase), ms: Number(d.ms) || 0, erro: curto(d.erro),
    http: Number(d.http) || 0, bytesRecebidos: Number(d.bytesRecebidos) || 0,
    fotoBytes: Number(d.fotoBytes) || 0, fotoTipo: curto(d.fotoTipo),
    online: d.online === true, visivel: curto(d.visivel), rede: curto(d.rede),
    agente: curto(req.headers.get('user-agent')),
  }))
  return new NextResponse(null, { status: 204 })
}
