-- Distingue, dentro da categoria "escola", dois tipos de item:
--   'atividade' → provas, trabalhos, reuniões, eventos (uso atual)
--   'aula'      → rotina diária de aulas (grade de horário semanal)
--
-- Coluna anulável: NULL equivale a 'atividade', então todas as linhas já
-- existentes continuam aparecendo no filtro "Atividades escolares" sem
-- precisar de backfill. Só faz sentido para category = 'escola'.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS school_kind text;

ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_school_kind_check;

ALTER TABLE activities
  ADD CONSTRAINT activities_school_kind_check
  CHECK (school_kind IS NULL OR school_kind IN ('atividade', 'aula'));

-- A aba /escola filtra por categoria + tipo; o índice parcial cobre
-- exatamente esse acesso sem pesar nas demais categorias.
CREATE INDEX IF NOT EXISTS idx_activities_school_kind
  ON activities (family_id, school_kind)
  WHERE category = 'escola';
