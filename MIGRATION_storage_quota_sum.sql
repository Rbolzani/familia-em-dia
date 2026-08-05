-- Soma a cota de storage no banco, em vez de trazer todas as linhas de
-- document_files para o Node e somar lá.
--
-- PROBLEMA: getFamilyStorageUsedBytes() fazia
--   .from('document_files').select('file_size')  →  soma no JS
-- O PostgREST corta a resposta em 1000 linhas por padrão. Uma família com
-- mais de 1000 arquivos teria a cota SUBCONTADA e passaria do limite do
-- plano sem ser barrada (fail-open silencioso).
--
-- Sem SECURITY DEFINER de propósito: assim a RLS de document_files
-- (family_id = auth_family_id()) continua valendo e escopa a soma à família
-- do chamador.
CREATE OR REPLACE FUNCTION public.family_storage_used_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(sum(file_size), 0)::bigint FROM public.document_files;
$$;
