-- Terceiro tipo dentro da categoria "escola": 'prova'.
--
--   'atividade' → trabalhos, reuniões, eventos (padrão; NULL equivale a isto)
--   'aula'      → rotina diária de aulas (grade de horário semanal)
--   'prova'     → calendário de provas
--
-- Só mexe no CHECK: a coluna, o índice e as linhas existentes ficam intactos.
-- NÃO há backfill — provas já cadastradas como atividade escolar continuam
-- onde estão (decisão registrada: a aba nova vale daqui pra frente).
--
-- Rodar ANTES do deploy do código: sem isto, salvar uma prova falha com
-- violação de constraint (23514) e o formulário quebra sem explicação útil.
ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_school_kind_check;

ALTER TABLE activities
  ADD CONSTRAINT activities_school_kind_check
  CHECK (school_kind IS NULL OR school_kind IN ('atividade', 'aula', 'prova'));
