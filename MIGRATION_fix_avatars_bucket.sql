-- ============================================================
-- CORREÇÃO DE SEGURANÇA — fotos das crianças abertas ao anônimo
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30 · Bloco 3 (Q1)
-- ============================================================
--
-- ACHADO (alto) — foto de qualquer criança, sem login
-- A policy `avatars_select` concedia SELECT do bucket INTEIRO ao papel
-- `public`:  USING (bucket_id = 'avatars')
-- `public` inclui `anon`, e a chave anônima está no bundle do cliente por
-- definição. O bucket é privado (`buckets.public = false`), o que dava a
-- impressão de proteção — mas o endpoint autenticado do Storage respeita a
-- RLS, e a RLS dizia "pode tudo".
--
-- A defesa imaginada era "o caminho contém o UUID do usuário, ninguém
-- adivinha". Isso é falso: a mesma policy libera a LISTAGEM.
--
-- EXPLORAÇÃO COMPROVADA, sem login, só com a chave anônima:
--   1. POST /storage/v1/object/list/avatars           → 200, devolve as pastas
--      (cada pasta é um user_id — enumeração pronta)
--   2. POST .../list/avatars com prefix=<user_id>     → 200, nomes dos arquivos
--   3. GET  /storage/v1/object/avatars/<uid>/<file>   → 200, image/jpeg, 1,5 MB
--          — a fotografia de uma criança.
--
-- CORREÇÃO
-- Leitura de escopo familiar, no mesmo modelo do bucket `documents`, e
-- `TO authenticated` para tirar o anônimo de cena. Validado depois:
-- listagem devolve [] e download devolve 400 para quem não é da família.
--
-- ⚠️ CACHE DE CDN: objetos servidos enquanto o furo existia ficam no cache do
-- Cloudflare (`Cache-Control: public, max-age=3600`) por até 1h após o último
-- acesso. A policy não invalida cache. Num incidente real seria necessário
-- renomear os objetos para trocar a chave de cache.
--
-- 🐛 BUG SEPARADO, não corrigido aqui (é mudança de código, não de banco):
-- `uploadPhoto` em ChildrenClient.tsx e OnboardingClient.tsx chama
-- `getPublicUrl()`, que monta uma URL `/object/public/avatars/...`. Esse
-- endpoint só funciona em bucket público — e este é privado, devolvendo 400.
-- Ou seja, a URL gravada em `children.avatar_url` nasce quebrada. Hoje há 12
-- objetos no bucket e ZERO linhas com avatar_url preenchido, o que é
-- consistente com a foto nunca ter aparecido. O certo é usar
-- `createSignedUrl()` com renovação, como o cofre de documentos já faz.

drop policy if exists avatars_select on storage.objects;

create policy avatars_select on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and (
    -- a própria pasta (o caminho é <user_id>/<arquivo>)
    (storage.foldername(name))[1] = (auth.uid())::text
    -- ou a pasta de alguém da minha família atual (parceiro vê a foto do filho)
    or exists (
      select 1 from public.family_members fm
      where fm.user_id::text = (storage.foldername(name))[1]
        and fm.family_id = public.auth_family_id()
    )
    or exists (
      select 1 from public.families f
      where f.created_by::text = (storage.foldername(name))[1]
        and f.id = public.auth_family_id()
    )
  )
);
