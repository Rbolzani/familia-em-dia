-- ============================================================
-- CORREÇÃO DE SEGURANÇA — RPC de notificação aberta ao anônimo
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30
-- ============================================================
--
-- ACHADO (alto) — injeção de notificação por qualquer pessoa
-- `create_logistics_notification(p_user_id, p_family_id, p_type, p_payload)`
-- é SECURITY DEFINER, não checa `auth.uid()` e tinha EXECUTE para `anon`.
-- Como toda função em `public` é exposta em /rest/v1/rpc/<nome> e a chave
-- anônima é pública, qualquer pessoa na internet podia gravar uma
-- notificação para QUALQUER usuário, com texto escolhido por ela.
--
-- EXPLORAÇÃO COMPROVADA antes da correção: POST anônimo devolveu 204 e a
-- linha apareceu em app_notifications. O texto do payload é renderizado no
-- sino (`notifLabel` em AppLayout) — phishing dentro do app, além de
-- crescimento ilimitado da tabela, já que não há limite de taxa em lugar
-- nenhum.
--
-- POR QUE O REVOKE É SEGURO
-- A função é chamada em UM lugar só: /api/logistics-action, server-side,
-- com o cliente admin (service role) — que ignora GRANTs de qualquer forma.
-- Nenhum código de cliente a invoca.
-- ⚠️ PUBLIC é obrigatório aqui. O Postgres concede EXECUTE a PUBLIC por
-- padrão ao criar uma função, e anon/authenticated herdam desse grant —
-- revogar só deles NÃO tem efeito nenhum. Comprovado: depois do primeiro
-- revoke a exploração ainda devolvia 204 e gravava a linha; o ACL mostrava
-- `=X/postgres`, cujo `=` sem nome de papel significa PUBLIC.
-- service_role tem grant EXPLÍCITO, então o cliente admin continua chamando.
REVOKE EXECUTE ON FUNCTION public.create_logistics_notification(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── Higiene: search_path fixo nas funções que não tinham ──────────────────
-- Uma função SECURITY DEFINER sem `search_path` fixo pode ser sequestrada
-- por quem consiga criar objetos num schema do caminho de busca.
-- VERIFICADO: hoje `anon` e `authenticated` têm CREATE = false em `public`,
-- então NÃO era explorável — é defesa em profundidade, não incêndio.
-- ALTER ... SET não mexe no corpo das funções.
ALTER FUNCTION public.update_updated_at()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.get_or_create_family(uuid)                             SET search_path = public, pg_temp;
ALTER FUNCTION public.auth_access_role()                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.create_logistics_notification(uuid, uuid, text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.create_my_family(text)                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.documents_search_tsv_update()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.add_owner_to_family_members()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.is_family_partner_of(uuid)                             SET search_path = public, pg_temp;
ALTER FUNCTION public.is_family_partner_of(uuid, uuid)                       SET search_path = public, pg_temp;

-- NÃO mexi em get_invite_details nem accept_invite: precisam continuar
-- executáveis (a prévia do convite roda para visitante sem sessão) e o
-- fluxo acabou de ser validado ponta a ponta.
