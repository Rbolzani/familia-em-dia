// Quem é fundador — as únicas contas com acesso ao Painel do negócio (/admin).
//
// A lista é FIXA no código do servidor, por id de usuário. De propósito:
//  · não há tela, tabela nem campo de perfil que transforme alguém em admin —
//    nada que um usuário (ou um bug de RLS) consiga alterar;
//  · o id é atribuído pelo Supabase Auth e não muda; o e-mail pode mudar, então
//    não serve de chave;
//  · se a lista sumir ou ficar vazia, ninguém entra (falha fechada).
// Para incluir ou tirar alguém, edite a lista e publique.
//
// A decisão é sempre tomada no servidor, a partir da sessão. O navegador só
// recebe um booleano para mostrar ou não o item de menu — esconder o item não
// é a proteção; a proteção é a conferência em cada carregamento da página.

import { createClient } from '@/lib/supabase/server'

const FUNDADORES: ReadonlySet<string> = new Set([
  '4edd5b7b-cb66-4357-87b4-89bfabca1691', // rogerbolzani
  '8f0719f9-43f3-465a-894b-dff1f18a3eda', // vanessa.enju
])

export function ehFundador(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && FUNDADORES.has(userId)
}

// Lê a sessão no servidor e devolve o id só se for fundador; senão, null.
// `getUser()` valida o token com o Supabase — não confia no cookie sozinho.
export async function fundadorLogado(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return ehFundador(user.id) ? user.id : null
}
