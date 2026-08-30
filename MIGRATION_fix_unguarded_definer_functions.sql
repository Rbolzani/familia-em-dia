-- ============================================================
-- CORREÇÃO DE SEGURANÇA — funções SECURITY DEFINER sem autorização
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30 · Bloco 3
-- ============================================================
--
-- CONTEXTO
-- O linter do Supabase apontou 21 funções SECURITY DEFINER chamáveis por
-- `anon` via /rest/v1/rpc/. A maioria é ruído ou já está protegida:
--   · 5 são funções de TRIGGER (retornam `trigger`) — o Postgres recusa
--     chamá-las diretamente, então o grant não significa nada;
--   · auth_in_family, create_my_family, switch_active_family e
--     is_family_partner_of(p_owner_id) TODAS derivam a identidade de
--     auth.uid(), que é NULO para anônimo — o pior caso é devolver false/null;
--   · accept_invite e get_invite_details são públicas de propósito (a prévia
--     do convite roda para visitante sem sessão) e já foram validadas.
--
-- Sobraram duas que aceitam identidade vinda do CHAMADOR, sem conferir nada.

-- ── 1. get_or_create_family(p_user_id) — ALTO ────────────────────────────
-- SECURITY DEFINER, aceitava qualquer uuid e ESCREVIA: se o alvo não tivesse
-- família, criava `families` + `family_members` em nome dele. Também devolvia
-- o family_id de qualquer usuário. Sem uma linha de autorização.
--
-- O FK para auth.users limita o estrago a IDs de usuários reais (não dá para
-- encher o banco com uuids aleatórios), mas continua sendo escrita em nome de
-- terceiro disparada por anônimo.
--
-- Chamada em UM lugar (src/lib/family.ts:28), sempre com o user.id da própria
-- sessão — o guard não muda o caminho legítimo. Mantido o parâmetro por
-- compatibilidade com o chamador; a autoridade agora é o token.
-- VALIDADO: uuid alheio → exceção; uuid próprio → continua funcionando.
create or replace function public.get_or_create_family(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'nao autorizado';
  end if;

  select id into v_id from families where created_by = p_user_id limit 1;
  if v_id is not null then return v_id; end if;

  select family_id into v_id from family_members where user_id = p_user_id limit 1;
  if v_id is not null then return v_id; end if;

  insert into families (created_by) values (p_user_id) returning id into v_id;
  insert into family_members (family_id, user_id, role) values (v_id, p_user_id, 'owner');
  return v_id;
end;
$function$;

-- ── 2. is_family_partner_of(me, other_user) — MÉDIO ──────────────────────
-- Oráculo de relacionamento: "os usuários X e Y estão na mesma família?".
-- Os dois uuids vêm do chamador e NÃO há nenhuma referência a auth.uid() —
-- qualquer pessoa na internet podia consultar. Não é usada em policy nem no
-- código do app (verificado em pg_policies, pg_proc e src/).
--
-- ⚠️ PUBLIC é obrigatório no revoke: o Postgres concede EXECUTE a PUBLIC por
-- padrão ao criar a função, e anon/authenticated herdam desse grant —
-- revogar só deles não tem efeito. Mesma lição do
-- MIGRATION_fix_rpc_grants_search_path.sql.
--
-- A sobrecarga de um argumento, is_family_partner_of(p_owner_id), foi mantida:
-- ela usa auth.uid() e é segura.
revoke execute on function public.is_family_partner_of(uuid, uuid)
  from public, anon, authenticated;
