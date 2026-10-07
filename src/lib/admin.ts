// Acesso ao Painel do negócio (/admin). A lista de fundadores e o porquê de
// ela ser fixa estão em `admin-ids.ts`.
//
// A decisão é sempre tomada no servidor, a partir da sessão, em DUAS camadas:
//  1. o proxy responde 404 a qualquer conta que não seja fundadora, antes de a
//     página começar a renderizar;
//  2. a própria página confere de novo (`fundadorLogado`) antes de consultar
//     qualquer dado — se o proxy mudar ou for contornado, ela continua fechada.
// O navegador só recebe um booleano para mostrar ou não o item de menu.
// Esconder o item não é a proteção.

import { createClient } from '@/lib/supabase/server'
import { ehFundador } from '@/lib/admin-ids'

export { ehFundador }

// Lê a sessão no servidor e devolve o id só se for fundador; senão, null.
// `getUser()` valida o token com o Supabase — não confia no cookie sozinho.
export async function fundadorLogado(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return ehFundador(user.id) ? user.id : null
}
