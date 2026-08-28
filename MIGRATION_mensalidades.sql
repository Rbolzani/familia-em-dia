-- ============================================================
-- MIGRATION — Mensalidades (compromissos financeiros recorrentes)
-- Projeto fawsbgxmrbpgcnlhjoao
-- ============================================================
--
-- Duas tabelas, de propósito:
--
--   payments       → a REGRA ("natação, R$ 280, todo dia 10")
--   payment_marks  → as EXCEÇÕES ("a competência 2026-09 foi paga")
--
-- As ocorrências mensais são CALCULADAS a partir da regra; só o que foi pago
-- vira linha. Gerar uma linha por mês encheria o banco de lixo previsível e
-- deixaria "cancelei a natação" sem resposta boa — aqui é `active = false`,
-- que preserva o histórico do que já foi pago.

-- 1. Regra recorrente
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id   uuid REFERENCES families(id) ON DELETE CASCADE,
  -- child_id anulável: há despesas da casa que não são de um filho específico
  child_id    uuid REFERENCES children(id) ON DELETE SET NULL,
  title       text NOT NULL,
  -- numeric, nunca float: centavos em ponto flutuante acumulam erro
  amount      numeric(10,2),
  -- 1..31. Meses curtos são resolvidos na aplicação (dia 31 cai no último
  -- dia do mês) — guardar o dia cru mantém a regra legível.
  due_day     integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  ai_generated boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- 2. Marcas de pagamento (uma por competência paga)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_marks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  family_id   uuid REFERENCES families(id) ON DELETE CASCADE,
  -- Competência no formato 'YYYY-MM'. Texto e não date porque o que se marca
  -- é o MÊS de referência, não um dia.
  competencia text NOT NULL CHECK (competencia ~ '^\d{4}-\d{2}$'),
  paid_at     timestamptz NOT NULL DEFAULT now(),
  -- `paid_by` fica para uma segunda onda (decisão registrada).
  created_at  timestamptz DEFAULT now(),
  -- Impede marcar o mesmo mês duas vezes — a UI é um toque, e um duplo
  -- clique geraria duas linhas sem esta trava.
  UNIQUE (payment_id, competencia)
);

CREATE INDEX IF NOT EXISTS idx_payments_family      ON payments (family_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_payment_marks_lookup ON payment_marks (payment_id, competencia);

-- 3. family_id automático no INSERT (mesma rede de segurança das demais)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_set_family_id ON public.payments;
CREATE TRIGGER trg_set_family_id BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_family_id_default();

DROP TRIGGER IF EXISTS trg_set_family_id ON public.payment_marks;
CREATE TRIGGER trg_set_family_id BEFORE INSERT ON public.payment_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_family_id_default();

-- 4. RLS — leitura por família, escrita gateada por papel
-- ------------------------------------------------------------
-- Mesmo desenho de activities/documents: o family_id está GRAVADO na linha,
-- então a leitura não depende de resolver associações em tempo de consulta.
ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments
  FOR SELECT USING ( family_id = public.auth_family_id() );

DROP POLICY IF EXISTS payments_insert ON payments;
CREATE POLICY payments_insert ON payments
  FOR INSERT WITH CHECK ( public.auth_can_edit() );

DROP POLICY IF EXISTS payments_update ON payments;
CREATE POLICY payments_update ON payments
  FOR UPDATE USING ( family_id = public.auth_family_id() AND public.auth_can_edit() )
         WITH CHECK ( family_id = public.auth_family_id() AND public.auth_can_edit() );

DROP POLICY IF EXISTS payments_delete ON payments;
CREATE POLICY payments_delete ON payments
  FOR DELETE USING ( family_id = public.auth_family_id() AND public.auth_can_edit() );

DROP POLICY IF EXISTS payment_marks_select ON payment_marks;
CREATE POLICY payment_marks_select ON payment_marks
  FOR SELECT USING ( family_id = public.auth_family_id() );

DROP POLICY IF EXISTS payment_marks_insert ON payment_marks;
CREATE POLICY payment_marks_insert ON payment_marks
  FOR INSERT WITH CHECK ( public.auth_can_edit() );

DROP POLICY IF EXISTS payment_marks_delete ON payment_marks;
CREATE POLICY payment_marks_delete ON payment_marks
  FOR DELETE USING ( family_id = public.auth_family_id() AND public.auth_can_edit() );

-- 5. Realtime — marcar como pago aparece ao vivo para o outro responsável
-- ------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE payment_marks;
ALTER TABLE payments      REPLICA IDENTITY FULL;
ALTER TABLE payment_marks REPLICA IDENTITY FULL;
