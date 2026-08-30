import type { SupabaseClient } from '@supabase/supabase-js'
import type { Child } from '@/lib/types'

/** Validade da URL assinada do avatar, em segundos. */
const AVATAR_TTL = 60 * 60   // 1h, igual ao cofre de documentos

/** Caminho canônico da foto: a família é a dona, não quem subiu. */
export function avatarPath(familyId: string, childId: string, ext: string) {
  return `${familyId}/${childId}.${ext.toLowerCase()}`
}

/**
 * Preenche `avatar_url` (campo transitório) a partir de `avatar_path` (o que
 * está no banco).
 *
 * Por que assinar aqui e não guardar a URL: o bucket é privado, então o link
 * precisa carregar um token — e token expira. Guardar a URL no banco só adia
 * o problema: em uma hora o link morre e a foto some. O banco guarda o
 * caminho, que é estável; a URL nasce a cada render.
 *
 * `createSignedUrls` (plural) faz um round-trip só para a lista inteira.
 * Falha aqui é silenciosa de propósito: sem foto o componente cai no avatar
 * de letra, que é um degradê aceitável — não vale derrubar a página.
 */
export async function signChildAvatars<T extends Pick<Child, 'avatar_path'>>(
  supabase: SupabaseClient,
  children: T[],
): Promise<(T & { avatar_url: string | null })[]> {
  const comFoto = children.filter(c => !!c.avatar_path)
  if (comFoto.length === 0) {
    return children.map(c => ({ ...c, avatar_url: null }))
  }

  const { data, error } = await supabase.storage
    .from('avatars')
    .createSignedUrls(comFoto.map(c => c.avatar_path as string), AVATAR_TTL)

  if (error || !data) {
    return children.map(c => ({ ...c, avatar_url: null }))
  }

  // A resposta traz `path` e `signedUrl` por item, e pode trazer `error` em
  // itens individuais (arquivo removido, por exemplo) — daí o filtro.
  const porCaminho = new Map(
    data.filter(d => d.signedUrl && !d.error).map(d => [d.path as string, d.signedUrl]),
  )

  return children.map(c => ({
    ...c,
    avatar_url: c.avatar_path ? (porCaminho.get(c.avatar_path) ?? null) : null,
  }))
}
