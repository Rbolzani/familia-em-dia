import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { onlyDigits } from '@/lib/cpf'

// Consulta de CEP para preencher o endereço sozinho. Passa pelo servidor para
// não abrir o CSP do navegador a um domínio externo. É só conveniência: se o
// ViaCEP estiver fora, o formulário segue com digitação manual.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cep = onlyDigits(new URL(request.url).searchParams.get('cep') ?? '')
  if (cep.length !== 8) return NextResponse.json({ error: 'CEP inválido.' }, { status: 400 })

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ found: false })
    const d = await res.json() as {
      erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string
    }
    if (d.erro) return NextResponse.json({ found: false })
    return NextResponse.json({
      found: true,
      street: d.logradouro ?? '',
      district: d.bairro ?? '',
      city: d.localidade ?? '',
      state: d.uf ?? '',
    })
  } catch {
    return NextResponse.json({ found: false })
  }
}
