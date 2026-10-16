// Botão "Enviar para mim um teste" do Painel do negócio: manda o aviso de fim
// do teste (WhatsApp + e-mail) para o FUNDADOR LOGADO, simulando um teste que
// termina em 3 dias. Mesmo código da rotina — é o que o cliente recebe.
// Só fundadores (fundadorLogado); qualquer outra conta recebe 404.
import { NextResponse } from 'next/server'
import { fundadorLogado } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarAvisoFimTeste } from '@/lib/aviso-fim-teste-envio'

export async function POST() {
  const userId = await fundadorLogado()
  if (!userId) return new NextResponse('Not Found', { status: 404 })

  // Fim simulado: daqui a 3 dias — a mensagem diz "em 3 dias" e a data correspondente.
  const fim = new Date(Date.now() + 3 * 86_400_000)
  const r = await enviarAvisoFimTeste(createAdminClient(), userId, fim, 'fim_teste_amostra')
  return NextResponse.json(r)
}
