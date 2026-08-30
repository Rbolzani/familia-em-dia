-- ============================================================
-- CORREÇÃO — trigger de logística por LISTA DE PERMISSÃO
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-29
-- ============================================================
--
-- ACHADO
-- enforce_logistics_only nomeava as colunas PROIBIDAS. Toda coluna criada
-- depois nascia editável por um parceiro "leitura + logística" — ninguém
-- lembra de voltar num trigger ao adicionar uma coluna. Já havia duas
-- escapando: `school_kind` (dá para mover a atividade entre Escola, Rotina
-- de aulas e Provas) e `ai_generated`.
--
-- CORREÇÃO
-- Inverte a lógica: compara a linha INTEIRA e permite apenas as duas colunas
-- de logística. Coluna nova passa a nascer PROTEGIDA, que é o padrão seguro.
--
-- `updated_at` fica de fora da comparação porque o trigger
-- `activities_updated_at` roda ANTES deste (o Postgres dispara em ordem
-- alfabética no mesmo timing) e já alterou o campo. Sem essa exclusão,
-- QUALQUER edição de logística seria rejeitada.

CREATE OR REPLACE FUNCTION public.enforce_logistics_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  antes  jsonb;
  depois jsonb;
begin
  if public.auth_access_role() = 'logistics_editor' then
    -- Tudo que NÃO for leva/busca precisa permanecer idêntico.
    antes  := to_jsonb(old) - 'takes_user_id' - 'picks_user_id' - 'updated_at';
    depois := to_jsonb(new) - 'takes_user_id' - 'picks_user_id' - 'updated_at';

    if antes is distinct from depois then
      raise exception 'Acesso de logística permite alterar apenas quem leva e quem busca.';
    end if;
  end if;
  return new;
end;
$function$;
