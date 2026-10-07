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
// Este arquivo não importa nada: é usado tanto pelo proxy (borda) quanto pelas
// páginas, e precisa rodar nos dois ambientes.

const FUNDADORES: ReadonlySet<string> = new Set([
  '4edd5b7b-cb66-4357-87b4-89bfabca1691', // rogerbolzani
  '8f0719f9-43f3-465a-894b-dff1f18a3eda', // vanessa.enju
])

export function ehFundador(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && FUNDADORES.has(userId)
}
