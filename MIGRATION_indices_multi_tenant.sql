-- ============================================================
-- Índices faltantes nas colunas por onde toda consulta passa
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30 · Bloco 4 (R2)
-- ============================================================
--
-- ACHADO
-- O app é multi-inquilino: a RLS filtra `family_id = auth_family_id()` em
-- TODA leitura. Mas `activities`, `documents` e `children` não tinham índice
-- liderado por `family_id`, e `document_files` tinha SÓ a chave primária.
--
-- Sem esse índice o planejador usa o índice de data e descarta as linhas das
-- outras famílias DEPOIS de lê-las — o custo cresce com o número de famílias
-- no banco, não com o tamanho da família consultada.
--
-- MEDIDO em transação, 1.500 atividades numa família:
--   antes  Index Scan por activities_date_idx
--          family_id no FILTER · "Rows Removed by Filter: 988" · buffers 1713
--   depois Index Scan por (family_id, date)
--          family_id no INDEX COND · removidas 468 · buffers 1211
--
-- O PIOR CASO era document_files.storage_path: a policy do bucket roda
--   EXISTS (select 1 from document_files df
--           where df.storage_path = objects.name and df.family_id = auth_family_id())
-- a CADA DOWNLOAD de arquivo. Sem índice, varredura sequencial da tabela
-- inteira por arquivo baixado.
--   MEDIDO com 20.010 linhas: Seq Scan → Index Scan, 0,042 ms.
--
-- Com os volumes de hoje (10 arquivos, 2.739 atividades) o planejador ainda
-- prefere varrer, e faz bem. Os índices existem para o ponto em que isso
-- deixa de ser verdade — e esse ponto chega sem aviso.

create index if not exists idx_activities_family_date
  on public.activities (family_id, date);

create index if not exists idx_documents_family
  on public.documents (family_id);

create index if not exists idx_children_family
  on public.children (family_id);

create index if not exists idx_document_files_storage_path
  on public.document_files (storage_path);

create index if not exists idx_document_files_document
  on public.document_files (document_id);

create index if not exists idx_document_files_family
  on public.document_files (family_id);

create index if not exists idx_payment_marks_family
  on public.payment_marks (family_id);

analyze public.activities;
analyze public.documents;
analyze public.document_files;
analyze public.children;
analyze public.payment_marks;
