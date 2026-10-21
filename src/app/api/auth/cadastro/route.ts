// Cadastro do modelo novo (teste de 14 dias com cartão, aprovado em 20/10/2026).
//
// POR QUE O SERVIDOR CRIA A CONTA
// No fluxo novo a pessoa vai direto do formulário para a tela de pagamento do
// Stripe (T3 → T4). Com o cadastro pelo Supabase no navegador, ela precisaria
// antes abrir o e-mail e clicar no link — uma etapa a mais onde desistir.
// Decisão do Rogério: a confirmação do e-mail não bloqueia. A conta nasce com
// o login liberado aqui, o navegador entra com a senha em seguida, e a pessoa
// recebe o e-mail "Confirme seu e-mail" (faixa no app até clicar — 21/10/2026).
//
// O endereço também é pedido aqui (CEP primeiro, com preenchimento automático):
// a tela do Stripe não preenche pelo CEP brasileiro e põe o CEP por último.
//
// O que impede abuso, já que esta rota não tem o limite de taxa do Supabase:
//  · limite de 5 cadastros por hora por IP (cadastro_tentativas);
//  · CPF válido e único (um teste por pessoa);
//  · a conta só ganha acesso depois do cartão no Stripe (nasce "incompleto").
//
// A conta nasce marcada como `oferta: 'v2'` nos metadados: é isso que faz o
// gatilho do banco criá-la no modelo novo (MIGRATION_nova_oferta_1.sql).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidCPF, isValidPhoneBR, onlyDigits } from '@/lib/cpf'
import { nomeCompleto } from '@/lib/stripe-customer'
import { LEGAL_VERSION } from '@/lib/legal'
import { concluirCadastroPelosMetadados } from '@/lib/cadastro'
import { addressError, addressToRow, normalizeAddress } from '@/lib/address'
import { enviarConfirmacaoEmail } from '@/lib/confirmacao-email'

const LIMITE_POR_HORA = 5
const MSG_CPF_EM_USO = 'Este CPF já está ligado a outra conta. Se for a sua, entre com o e-mail dela ou recupere a senha. Precisa de ajuda? suporte@familiaemdia.com.br'

function ipDe(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  return (xff?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'desconhecido').trim().slice(0, 64)
}

export async function POST(request: Request) {
  let b: Record<string, unknown>
  try { b = await request.json() } catch { return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 }) }

  const s = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const nome = s(b.nome, 120)
  const familia = s(b.familia, 80) || 'Minha Família'
  const email = s(b.email, 200).toLowerCase()
  const senha = typeof b.senha === 'string' ? b.senha : ''
  const celular = onlyDigits(s(b.celular, 30))
  const cpf = onlyDigits(s(b.cpf, 20))
  const origem = s(b.origem, 60)
  const plano = b.plano === 'basico' || b.plano === 'plus' ? b.plano : 'familia'
  const ciclo = b.ciclo === 'year' ? 'year' : 'month'
  const endereco = normalizeAddress(b.endereco as Record<string, unknown> | null)

  if (!nomeCompleto(nome)) return NextResponse.json({ error: 'Informe seu nome e sobrenome.' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 })
  if (senha.length < 8) return NextResponse.json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, { status: 400 })
  if (!isValidPhoneBR(celular)) return NextResponse.json({ error: 'Celular inválido. Use DDD + número.' }, { status: 400 })
  if (!isValidCPF(cpf)) return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 })
  const erroEndereco = addressError(endereco)
  if (erroEndereco) return NextResponse.json({ error: erroEndereco }, { status: 400 })
  if (!origem) return NextResponse.json({ error: 'Conte como você nos conheceu.' }, { status: 400 })
  if (b.termos !== true) return NextResponse.json({ error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade.' }, { status: 400 })

  const admin = createAdminClient()

  // Limite por IP
  const ip = ipDe(request)
  const umaHora = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await admin.from('cadastro_tentativas').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('criado_em', umaHora)
  if ((count ?? 0) >= LIMITE_POR_HORA) {
    return NextResponse.json({ error: 'Muitos cadastros feitos deste endereço. Tente de novo daqui a uma hora.' }, { status: 429 })
  }
  await admin.from('cadastro_tentativas').insert({ ip })

  // CPF único (T6)
  const { data: dono } = await admin.from('profiles').select('user_id').eq('cpf', cpf).maybeSingle()
  if (dono) return NextResponse.json({ error: MSG_CPF_EM_USO, code: 'cpf_em_uso' }, { status: 409 })

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: {
      oferta: 'v2',
      plano,
      ciclo,
      full_name: nome,
      family_name: familia,
      phone: celular,
      acquisition_source: origem,
      marketing_consent: b.marketing === true,
      terms_accepted: true,
      terms_version: LEGAL_VERSION,
      attribution: b.atribuicao && typeof b.atribuicao === 'object' ? b.atribuicao : null,
    },
  })
  if (error || !data.user) {
    const jaExiste = /already|registered|exists/i.test(error?.message ?? '')
    return NextResponse.json(
      { error: jaExiste ? 'Este e-mail já está cadastrado. Entre com ele ou recupere a senha.' : 'Não foi possível criar a conta. Tente de novo.', code: jaExiste ? 'email_em_uso' : undefined },
      { status: 400 },
    )
  }

  // Grava o CPF já agora: o índice único fecha a corrida entre dois cadastros
  // simultâneos com o mesmo CPF — o segundo perde e a conta dele é desfeita.
  const { error: errCpf } = await admin.from('profiles').upsert(
    { user_id: data.user.id, cpf, ...addressToRow(endereco), email_confirmado_em: null },
    { onConflict: 'user_id' },
  )
  if (errCpf) {
    await admin.auth.admin.deleteUser(data.user.id)
    return errCpf.code === '23505'
      ? NextResponse.json({ error: MSG_CPF_EM_USO, code: 'cpf_em_uso' }, { status: 409 })
      : NextResponse.json({ error: 'Não foi possível criar a conta. Tente de novo.' }, { status: 500 })
  }

  // Perfil concluído já agora (nome, celular, aceite): o navegador vai direto
  // para o pagamento, e o checkout exige o nome completo no perfil.
  await concluirCadastroPelosMetadados(data.user)

  // Não bloqueia: se o envio falhar, a faixa no app oferece "Reenviar".
  await enviarConfirmacaoEmail(data.user.id, email, nome).catch(e => console.error('[cadastro] confirmação de e-mail:', e))

  return NextResponse.json({ ok: true })
}
