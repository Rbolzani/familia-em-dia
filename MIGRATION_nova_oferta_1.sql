-- Nova oferta comercial (aprovada em 20/10/2026): 3 planos, teste de 14 dias
-- COM cartão no cadastro, sem plano gratuito para contas novas.
--
-- ⚠️ Esta migração é ADITIVA e roda em produção antes da virada: o modelo
-- antigo (teste sem cartão, gratuito ao fim) precisa continuar idêntico.
-- O modelo novo só vale para contas criadas pelo cadastro novo, que manda
-- `oferta = 'v2'` nos metadados do usuário. Contas sem essa marca seguem o
-- modelo antigo para sempre (Termos 5.12).

-- 1. Estado da assinatura no modelo novo -------------------------------------
alter table public.subscriptions
  add column if not exists oferta            text not null default 'v1',
  add column if not exists paused_at         timestamptz,
  add column if not exists pause_reason      text,          -- 'cancelada' | 'pagamento'
  add column if not exists delete_after      timestamptz,   -- paused_at + 90 dias
  add column if not exists payment_failed_at timestamptz,   -- início da carência de 7 dias
  add column if not exists trial_card_checked boolean not null default false;

comment on column public.subscriptions.oferta is
  'v1 = modelo antigo (teste sem cartão, gratuito ao fim). v2 = modelo novo (teste com cartão, sem gratuito).';
comment on column public.subscriptions.status is
  'free (gratuito antigo) · incompleto (v2 sem cartão ainda) · trialing · active · past_due (cartão recusado, carência) · paused (v2 sem assinatura válida)';

-- 2. Cartões que já usaram o teste grátis (um teste por cartão) --------------
create table if not exists public.trial_cartoes (
  fingerprint text primary key,              -- identificação do cartão gerada pelo Stripe (não revela o número)
  user_id     uuid not null references auth.users(id) on delete cascade,
  criado_em   timestamptz not null default now()
);
alter table public.trial_cartoes enable row level security;
-- Sem policies: só o servidor (service_role) lê e grava.

-- 3. Avisos de conta já enviados (idempotência dos e-mails e WhatsApp) -------
create table if not exists public.avisos_conta (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null,                  -- ex.: confirmacao_teste, cadastro_incompleto, cartao_d0, cartao_d5, pausa, exclusao_30, exclusao_7, cancelamento
  chave      text not null default '',       -- distingue repetições legítimas (ex.: id da assinatura, data da pausa)
  enviado_em timestamptz not null default now(),
  whatsapp   boolean not null default false,
  email      boolean not null default false,
  primary key (user_id, tipo, chave)
);
alter table public.avisos_conta enable row level security;

-- 4. Aviso de 7 dias antes do fim do teste (exigência da Visa) ---------------
alter table public.aviso_fim_teste drop constraint if exists aviso_fim_teste_etapa_check;
alter table public.aviso_fim_teste add constraint aviso_fim_teste_etapa_check
  check (etapa = any (array['d7'::text, 'd3'::text, 'd1'::text]));

-- 5. Nova conta: modelo antigo ou novo conforme o cadastro -------------------
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_plano text  := v_meta->>'plano';
  v_ciclo text  := v_meta->>'ciclo';
begin
  insert into public.profiles(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if v_meta->>'oferta' = 'v2' then
    -- Modelo novo: a conta nasce sem plano ativo até o cartão ser cadastrado
    -- no Stripe. Guarda o plano e o ciclo escolhidos no cadastro.
    insert into public.subscriptions(user_id, plan, status, billing_interval, trial_ends_at, oferta)
    values (
      new.id,
      case when v_plano in ('basico','familia','plus') then v_plano else 'familia' end,
      'incompleto',
      case when v_ciclo in ('month','year') then v_ciclo else 'month' end,
      null,
      'v2'
    )
    on conflict (user_id) do nothing;
  else
    -- Modelo antigo (inclui convidados por link): teste de 14 dias sem cartão.
    insert into public.subscriptions(user_id, plan, status, trial_ends_at)
    values (new.id, 'familia', 'trialing', now() + interval '14 days')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$function$;

-- 6. Conta pausada ou incompleta = só leitura, para todos da família ---------
-- A escrita de conteúdo (atividades, filhos, documentos, mensalidades, fotos)
-- já passa por auth_can_edit / auth_can_edit_logistics. Acrescentar a situação
-- da assinatura do DONO da família ali faz a pausa valer no banco, para o dono
-- e para os convidados (que voltam ao nível que tinham quando a conta reativa).
create or replace function public.familia_pode_editar()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((
    select s.status not in ('paused', 'incompleto')
    from public.families f
    join public.subscriptions s on s.user_id = f.created_by
    where f.id = public.auth_family_id()
    limit 1
  ), true)
$function$;

create or replace function public.auth_can_edit()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.auth_access_role() in ('owner','full_editor') and public.familia_pode_editar()
$function$;

create or replace function public.auth_can_edit_logistics()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.auth_access_role() in ('owner','full_editor','logistics_editor') and public.familia_pode_editar()
$function$;

-- 7. Plano da família -----------------------------------------------------------
-- pausada: conta do modelo novo sem assinatura válida (inclui o cadastro não
-- concluído). past_due (cartão recusado) mantém o plano durante a carência.
create or replace function public.get_family_plan()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (
      select case
               when s.status in ('paused', 'incompleto') then 'pausada'
               when s.status in ('trialing', 'active', 'past_due') then s.plan
               else 'free'
             end
      from public.families f
      join public.subscriptions s on s.user_id = f.created_by
      where f.id = public.auth_family_id()
      limit 1
    ),
    'free'
  )
$function$;

revoke all on function public.familia_pode_editar() from public, anon;
grant execute on function public.familia_pode_editar() to authenticated, service_role;

-- 8. (aplicada como nova_oferta_2_cadastro_tentativas) Limite de cadastros por IP
create table if not exists public.cadastro_tentativas (
  id        bigint generated always as identity primary key,
  ip        text not null,
  criado_em timestamptz not null default now()
);
create index if not exists cadastro_tentativas_ip_idx on public.cadastro_tentativas (ip, criado_em desc);
alter table public.cadastro_tentativas enable row level security;

-- 9. (aplicada como nova_oferta_3_excluir_conta) public.excluir_conta(p_uid)
-- Mesmo corpo de delete_my_account, chamável só pelo service_role (exclusão
-- automática da conta pausada há 90 dias). delete_my_account() passou a ser
-- só `return public.excluir_conta(auth.uid())`. Ver o SQL completo no histórico
-- de migrações do Supabase (nova_oferta_3_excluir_conta).

-- 10. (aplicada como nova_oferta_4_contas_excluidas_pausada)
alter table public.contas_excluidas drop constraint if exists contas_excluidas_situacao_check;
alter table public.contas_excluidas add constraint contas_excluidas_situacao_check
  check (situacao in ('teste','pagante','gratuito','cortesia','pausada','incompleto'));

-- 11. (aplicada como nova_oferta_5_trial_cartoes_sem_cascata)
-- "Um teste por cartão" vale mesmo depois de a conta ser apagada.
alter table public.trial_cartoes drop constraint if exists trial_cartoes_user_id_fkey;
alter table public.trial_cartoes alter column user_id drop not null;
