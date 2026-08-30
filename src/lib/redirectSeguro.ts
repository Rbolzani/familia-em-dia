// Validação do destino de redirecionamento pós-login.
//
// POR QUE ISTO EXISTE
// Três lugares liam `?redirect=` / `?next=` da URL e devolviam o usuário para
// lá depois de autenticar, guardados por `startsWith('/') && !startsWith('//')`.
// A intenção estava certa — recusar URL absoluta e protocolo-relativa — mas o
// teste tem um furo: **a barra invertida**.
//
//   new URL('/\\evil.example', 'https://www.familiaemdia.com.br/auth/login')
//     → https://evil.example/
//
// O padrão WHATWG manda tratar `\` como `/` em esquemas especiais (http/https),
// então `/\evil.example` É `//evil.example` para o navegador — e para o próprio
// `new URL`, que o middleware usava para montar a resposta. O guard via só a
// forma com duas barras.
//
// O ataque é um redirecionamento aberto, e vale justamente por parecer legítimo:
//   https://www.familiaemdia.com.br/auth/login?redirect=/\site-falso.exemplo
// O link é do domínio real, com cadeado e tudo. Quem já está logado é levado
// para fora sem nenhum aviso — e um clone da tela de login colhe a senha.
// Num app que guarda documento de criança, é o pior desfecho possível.
//
// A troca é de lista de bloqueio para lista de permissão: em vez de enumerar as
// formas ruins (sempre incompleta), exigimos a forma boa.

const DESTINO_PADRAO = '/dashboard'

/**
 * Devolve um caminho interno seguro, ou `/dashboard` se o valor não for
 * inequivocamente um caminho do próprio site.
 *
 * Aceita apenas: uma barra, seguida de algo que não seja outra barra nem
 * barra invertida. Recusa URL absoluta, protocolo-relativa (`//host`),
 * a variante com barra invertida (`/\host`) e qualquer coisa que não comece
 * com `/`.
 */
export function destinoInternoSeguro(bruto: string | null | undefined): string {
  if (!bruto) return DESTINO_PADRAO

  // Navegadores descartam TAB, CR e LF em qualquer posição da URL antes de
  // resolvê-la — `/\tevil` chega ao destino como `/evil`. Removemos os mesmos
  // caracteres ANTES de validar, senão a inspeção olha um texto e o navegador
  // navega para outro.
  const limpo = bruto.replace(/[\t\n\r]/g, '')

  if (!limpo.startsWith('/')) return DESTINO_PADRAO
  // Segundo caractere não pode ser separador: barra e barra invertida abrem
  // AUTORIDADE (host), não caminho.
  if (limpo[1] === '/' || limpo[1] === '\\') return DESTINO_PADRAO

  return limpo
}
