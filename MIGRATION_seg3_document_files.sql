-- Segurança, item 3 (11/10/2026): arquivo do cofre "adotado" por outra família.
--
-- ANTES: a policy de INSERT de `document_files` só conferia a família e o papel
-- de quem inseria; `storage_path` era livre. Como as regras do bucket
-- `documents` liberam leitura e exclusão para quem tem uma linha em
-- `document_files` apontando para o caminho, bastava inserir uma linha na
-- PRÓPRIA família com o caminho de um arquivo ALHEIO para voltar a abri-lo ou
-- apagá-lo. Quem conhece o caminho: qualquer pessoa que já teve acesso à
-- família (ex-parceiro), porque ele vem nas respostas da API.
--
-- DEPOIS: a linha só entra se o caminho começar com o id de quem insere (é
-- como as rotas de upload já montam: `<user_id>/<doc_id>/<arquivo>`), e cada
-- caminho só pode existir uma vez.
--
-- Conferido antes de aplicar: 13 de 13 linhas existentes seguem o formato, e
-- não há caminho repetido.
--
-- REVERTER:
--   drop policy document_files_insert on public.document_files;
--   create policy document_files_insert on public.document_files for insert
--     with check ((family_id = auth_family_id()) and auth_can_edit());
--   drop index if exists public.document_files_storage_path_key;

drop policy if exists document_files_insert on public.document_files;
create policy document_files_insert on public.document_files for insert
  with check (
    family_id = auth_family_id()
    and auth_can_edit()
    and split_part(storage_path, '/', 1) = (auth.uid())::text
  );

create unique index if not exists document_files_storage_path_key
  on public.document_files (storage_path);
