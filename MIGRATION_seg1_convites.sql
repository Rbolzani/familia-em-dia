-- Segurança, item 1 (11/10/2026): convite forjado.
--
-- ANTES: a policy `invite_creator` (FOR ALL, `auth.uid() = invited_by`) deixava
-- qualquer usuário logado INSERIR um convite direto pelo navegador, para
-- QUALQUER family_id e com qualquer nível de acesso, e `accept_invite` aceitava
-- sem conferir se quem convidou era dono da família. Resultado: um convidado
-- "somente leitura" se promovia a "acesso completo", um ex-parceiro removido
-- voltava sozinho, e quem soubesse o id de uma família entrava nela.
--
-- DEPOIS:
--   * convite só nasce no servidor (/api/invites/create e /api/onboarding/invite,
--     que usam a service role e conferem o dono);
--   * o cliente lê e apaga os próprios convites e só altera `status` e
--     `shared_at` (o que a tela Compartilhar Acesso faz);
--   * `accept_invite` exige que quem convidou seja o dono da família, e recusa
--     o dono aceitando o próprio convite (isso o rebaixaria a parceiro).
--
-- REVERTER (volta ao estado anterior, com a falha):
--   drop policy if exists invites_select_own on public.family_invites;
--   drop policy if exists invites_update_own on public.family_invites;
--   drop policy if exists invites_delete_own on public.family_invites;
--   create policy invite_creator on public.family_invites for all
--     using (auth.uid() = invited_by) with check (auth.uid() = invited_by);
--   grant insert, update on public.family_invites to authenticated;
--   e recriar accept_invite sem as duas checagens novas.

begin;

drop policy if exists invite_creator on public.family_invites;

create policy invites_select_own on public.family_invites
  for select to authenticated using (auth.uid() = invited_by);
create policy invites_update_own on public.family_invites
  for update to authenticated using (auth.uid() = invited_by) with check (auth.uid() = invited_by);
create policy invites_delete_own on public.family_invites
  for delete to authenticated using (auth.uid() = invited_by);

-- Sem INSERT pelo cliente; UPDATE só nas duas colunas que a tela usa. Assim
-- ninguém troca family_id, access_role, token ou validade de um convite.
revoke all on public.family_invites from anon;
revoke insert, update, truncate, references, trigger on public.family_invites from authenticated;
grant update (status, shared_at) on public.family_invites to authenticated;

create or replace function public.accept_invite(p_token text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_invite record;
  v_dono   uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_invite
  from public.family_invites
  where token::text = p_token
    and status = 'pending'
    and expires_at > now();

  if not found then
    return false;
  end if;

  -- O convite só vale se foi emitido pelo DONO da família.
  select created_by into v_dono from public.families where id = v_invite.family_id;
  if v_dono is null or v_dono is distinct from v_invite.invited_by then
    return false;
  end if;

  -- O dono não aceita o próprio convite: o upsert abaixo o rebaixaria a parceiro.
  if v_dono = auth.uid() then
    return false;
  end if;

  insert into public.family_members (family_id, user_id, role, access_role)
  values (v_invite.family_id, auth.uid(), 'partner', v_invite.access_role)
  on conflict (family_id, user_id)
  do update set role = 'partner', access_role = excluded.access_role;

  update public.family_invites
  set status = 'accepted'
  where id = v_invite.id;

  return true;
end;
$function$;

commit;
