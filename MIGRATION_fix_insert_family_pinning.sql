-- ============================================================
-- CORREÇÃO DE SEGURANÇA — INSERT sem amarrar a família
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30 · Bloco 3 (N3)
-- ============================================================
--
-- ACHADO (alto) — plantar dados na família alheia
-- As policies de INSERT de activities, children, documents, document_files,
-- payments e payment_marks checavam APENAS `auth_can_edit()`. Nenhuma delas
-- exigia que a linha nova pertencesse à família de quem escreve.
--
-- O `family_id` era considerado protegido pelo trigger `set_family_id_default`,
-- mas ele só age quando o campo vem NULO:
--     if new.family_id is null then new.family_id := auth_family_id(); end if;
-- Quem envia o `family_id` explicitamente passa direto por ele — e o PostgREST
-- aceita qualquer coluna no corpo do INSERT.
--
-- EXPLORAÇÃO COMPROVADA (em transação, com rollback) — um usuário autenticado
-- comum, sem nenhum vínculo com a família alvo:
--   1. inseriu um `children` na família alheia, com o UUID escolhido por ele;
--   2. usou esse UUID para inserir uma `activities` na agenda alheia;
--   3. inseriu um `documents` no cofre alheio;
--   4. inseriu uma `payments` nas mensalidades alheias.
-- Todas as quatro linhas foram gravadas. As vítimas veriam o conteúdo no
-- dashboard, no calendário e no resumo diário do WhatsApp, sem forma de saber
-- de onde veio.
--
-- Isto é INJEÇÃO, não vazamento: a leitura continuou correta o tempo todo
-- (`family_id = auth_family_id()` nas policies de SELECT). O modelo
-- "leak-proof" nunca cobriu o sentido oposto.
--
-- ⚠️ ARMADILHA DE TESTE, registrada porque quase produziu um falso negativo:
-- a primeira tentativa usou `INSERT ... RETURNING` e foi rejeitada com
-- "new row violates row-level security policy". A rejeição não era do INSERT —
-- era do RETURNING, que exige a policy de SELECT e batia no `family_id` alheio.
-- Sem repetir SEM o RETURNING e contar as linhas como superusuário, o teste
-- teria sido marcado como aprovado. Nunca aceitar "deu erro" como prova de
-- que a escrita foi barrada.
--
-- CORREÇÃO
-- Amarra a família no WITH CHECK, no mesmo formato que `logistics_suggestions`
-- e as policies de UPDATE já usavam. O caminho legítimo não muda: o cliente
-- envia `family_id` nulo, o trigger preenche com `auth_family_id()` ANTES do
-- WITH CHECK (BEFORE trigger roda antes da checagem), e a policy aprova.
-- Verificado: nenhum código do app envia `family_id` explícito nestas seis
-- tabelas pelo cliente; as rotas de API usam service_role, que ignora RLS.

-- ── activities ────────────────────────────────────────────────────────────
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert with check (family_id = public.auth_family_id() and public.auth_can_edit());

-- ── children ──────────────────────────────────────────────────────────────
drop policy if exists children_insert on public.children;
create policy children_insert on public.children
  for insert with check (family_id = public.auth_family_id() and public.auth_can_edit());

-- ── documents ─────────────────────────────────────────────────────────────
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert with check (family_id = public.auth_family_id() and public.auth_can_edit());

-- ── document_files ────────────────────────────────────────────────────────
-- Aqui o family_id vem do documento pai (trigger set_doc_file_family_id), o
-- que já amarrava indiretamente — mas só quando o campo vinha nulo, igual às
-- outras. A checagem explícita fecha o caso do valor enviado à mão.
drop policy if exists document_files_insert on public.document_files;
create policy document_files_insert on public.document_files
  for insert with check (family_id = public.auth_family_id() and public.auth_can_edit());

-- ── payments ──────────────────────────────────────────────────────────────
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert with check (family_id = public.auth_family_id() and public.auth_can_edit());

-- ── payment_marks ─────────────────────────────────────────────────────────
drop policy if exists payment_marks_insert on public.payment_marks;
create policy payment_marks_insert on public.payment_marks
  for insert with check (family_id = public.auth_family_id() and public.auth_can_edit());
