// Redação de dado pessoal antes de sair para o Sentry.
//
// POR QUE ISTO EXISTE
// O Sentry converte `console.*` em breadcrumbs e as anexa a cada evento. Os
// logs do servidor carregam coisas como o NOME DO ARQUIVO que o usuário
// anexou ("20240321 CNH Rogério.pdf" — nome de pessoa) e o objeto de erro
// cru do PostgREST, que numa violação de unicidade traz o VALOR do campo:
// numa colisão de CPF, o CPF vai junto.
//
// Isso é dado pessoal saindo do Brasil (o projeto Sentry fica nos EUA) sem
// necessidade nenhuma para depurar — o que interessa num erro é o tipo, não
// de quem era o documento.
//
// A redação aqui é a última linha de defesa. A primeira é não logar: os
// pontos que logavam nome de arquivo passaram a logar extensão e tamanho.

import type { ErrorEvent, Breadcrumb } from '@sentry/nextjs'

/** Padrões de dado pessoal que podem escapar para mensagens de erro. */
const PADROES: [RegExp, string][] = [
  // CPF/CNPJ com ou sem máscara. Vem antes dos demais porque é o mais
  // sensível e o que o PostgREST expõe em violação de unicidade.
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]'],
  // Telefone BR com DDD, com ou sem +55.
  [/(\+55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]'],
]

function redigirValor(valor: unknown): unknown {
  if (typeof valor === 'string') {
    let s = valor
    for (const [re, sub] of PADROES) s = s.replace(re, sub)
    return s
  }
  if (Array.isArray(valor)) return valor.map(redigirValor)
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) saida[k] = redigirValor(v)
    return saida
  }
  return valor
}

/** Percorre o valor inteiro e substitui os padrões, preservando o formato. */
export function redigir<T>(valor: T): T {
  return redigirValor(valor) as T
}

/**
 * Opções comuns aos três ambientes (browser, servidor e edge).
 *
 * `sendDefaultPii: false` é o padrão do SDK, mas fica explícito: é ele que
 * impede o envio de cookies, cabeçalhos de autenticação e IP do usuário, e
 * um `true` acidental aqui vazaria a sessão inteira para o Sentry.
 */
export const opcoesComuns = {
  sendDefaultPii: false,
  beforeSend(event: ErrorEvent): ErrorEvent { return redigir(event) },
  beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb { return redigir(breadcrumb) },
}
