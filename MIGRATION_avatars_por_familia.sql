-- ============================================================
-- ESTRUTURAL — foto do filho passa a pertencer à FAMÍLIA
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30
-- ============================================================
--
-- PROBLEMA (três sintomas, uma raiz)
-- O caminho do avatar era `<user_id_de_quem_subiu>/<child_id>_<ts>.<ext>` —
-- indexado por USUÁRIO. Isso gerava três defeitos que pareciam separados:
--
--   1. A coluna `children.avatar_url` guardava uma URL de `getPublicUrl()`,
--      que só resolve em bucket público. Este bucket é privado, então a URL
--      devolvia 400 "Bucket not found". Comprovado com um arquivo existente.
--      A foto nunca aparecia.
--   2. Na exclusão de conta não dava para limpar o bucket por família: numa
--      família compartilhada, a foto que o pai subiu é a foto do filho que
--      fica com a mãe. As fotos ficavam para sempre — problema de LGPD.
--   3. Depois que o dono da pasta saía da família, a leitura (que confere se
--      o dono da pasta é da sua família) deixava de autorizar: a foto sumia
--      sem ninguém ter apagado nada.
--
-- CORREÇÃO
-- Caminho passa a ser `<family_id>/<child_id>.<ext>`, como o cofre de
-- documentos. A foto pertence à família: a transferência de titularidade
-- funciona sozinha, a leitura não depende de um usuário existir, e a exclusão
-- de conta fica idêntica à dos documentos (apaga nas famílias que morrem com
-- a conta, preserva onde há parceiro).
--
-- Sem timestamp no nome + `upsert: true`: trocar a foto SUBSTITUI o arquivo,
-- em vez de acumular um órfão por troca.
--
-- A coluna guarda o CAMINHO; a URL assinada (1h) nasce a cada render, em
-- `signChildAvatars()` (src/lib/avatars.ts), chamado no layout de (app) e em
-- children/page.tsx. Guardar a URL no banco só adiaria o problema — em uma
-- hora o link morre e a foto some.
--
-- RENAME em vez de DROP: não perde dado, e o compilador acha todo uso.
alter table public.children rename column avatar_url to avatar_path;

-- ⚠️ ÓRFÃOS: os 12 arquivos que já estavam no bucket ficam sob pastas de
-- user_id e deixam de casar com estas policies — inacessíveis a qualquer
-- usuário (só service role). Não há `avatar_path` apontando para nenhum deles
-- (a URL quebrada nunca chegou a ser gravada), então nada na UI regride.
-- Verificado após a mudança: caminho novo casa, caminho antigo não.
-- Devem ser apagados à mão no painel do Storage — são fotos de crianças sem
-- dono, e retenção sem finalidade é exatamente o que a LGPD veda.

drop policy if exists avatars_select on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_select on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (public.auth_family_id())::text
);

create policy avatars_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (public.auth_family_id())::text
  and public.auth_can_edit()
);

create policy avatars_update on storage.objects
for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (public.auth_family_id())::text
  and public.auth_can_edit()
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (public.auth_family_id())::text
  and public.auth_can_edit()
);

create policy avatars_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (public.auth_family_id())::text
  and public.auth_can_edit()
);
