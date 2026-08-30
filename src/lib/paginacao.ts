// Leitura completa de tabelas que podem passar de mil linhas.
//
// POR QUE ISTO EXISTE
// O PostgREST devolve no máximo 1000 linhas por requisição e NÃO avisa: não
// há erro, não há campo indicando corte. Comprovado no banco de produção —
// existem 1.239 atividades e um `select` simples devolveu exatamente 1.000.
//
// Onde isso morde, morde calado:
//   · o cron do WhatsApp lê `notification_settings` de TODOS os usuários; a
//     partir de mil assinantes, quem estivesse além da milésima linha nunca
//     receberia o resumo, e o log diria "concluído" do mesmo jeito;
//   · a exclusão de conta lê `document_files` para apagar do Storage; acima
//     de mil arquivos, o excedente ficaria no bucket depois de a conta ter
//     sido apagada — exatamente o problema de LGPD que já corrigimos uma vez
//     por outro caminho.
//
// Este é o mesmo defeito que já apareceu em `family_storage_used_bytes`, onde
// a soma era feita no cliente e subcontava a cota de famílias com muitos
// arquivos. Lá a saída foi somar no banco; aqui, paginar.

/** Tamanho da página. Igual ao teto do PostgREST: uma volta por lote cheio. */
const PAGINA = 1000

/**
 * Teto de segurança. 100 páginas = 100 mil linhas. Existe para que um erro de
 * filtro vire um erro visível em vez de um laço que consome a função inteira.
 */
const MAX_PAGINAS = 100

/**
 * Percorre todas as páginas de uma consulta.
 *
 * `monta` recebe o intervalo e devolve a consulta já com `.range(de, ate)`.
 * Exemplo:
 *
 *   const linhas = await buscarTodas((de, ate) =>
 *     admin.from('document_files').select('storage_path').in('family_id', ids).range(de, ate))
 */
export async function buscarTodas<T>(
  monta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = []
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * PAGINA
    const { data, error } = await monta(de, de + PAGINA - 1)
    if (error) throw error
    const lote = data ?? []
    tudo.push(...lote)
    // Lote incompleto significa fim: não há próxima página para buscar.
    if (lote.length < PAGINA) return tudo
  }
  console.error('[paginacao] teto de %d paginas atingido — consulta sem filtro?', MAX_PAGINAS)
  return tudo
}
