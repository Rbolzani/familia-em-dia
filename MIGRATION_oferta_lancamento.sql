-- Oferta de lançamento: 20 vagas com ~25% de desconto para sempre, em qualquer plano.
--
-- POR QUE AQUI E NÃO NUM CUPOM DO STRIPE
-- Os preços de lançamento são valores redondos (R$ 29,90, R$ 44,90…), e um
-- cupom percentual cobraria centavos quebrados (25% de R$ 39,90 = R$ 29,92).
-- Com preços próprios no Stripe, o limite de 20 deixa de ser contado pelo
-- cupom e passa a ser contado aqui.
--
-- COMO A VAGA ANDA
--   reservar  → ao abrir o checkout: ocupa a vaga por alguns minutos.
--   confirmar → quando a assinatura nasce (webhook / reconciliação).
--   expirar   → reserva vencida (checkout abandonado) é apagada na próxima
--               reserva — a vaga volta para a fila sozinha.
-- Uma vaga confirmada nunca volta, nem se a pessoa cancelar.
--
-- user_id SEM foreign key de propósito: excluir a conta não devolve a vaga.
-- Só o service role acessa (RLS ligada, sem policies; funções revogadas
-- de anon/authenticated).

create table if not exists public.oferta_lancamento_vagas (
  user_id       uuid primary key,
  status        text not null check (status in ('reservada', 'confirmada')),
  reservada_ate timestamptz,
  criado_em     timestamptz not null default now(),
  confirmada_em timestamptz
);

alter table public.oferta_lancamento_vagas enable row level security;

-- Reserva atômica: o advisory lock serializa as chamadas, então duas pessoas
-- abrindo o checkout no mesmo instante não conseguem ocupar a 20ª vaga juntas.
create or replace function public.reservar_vaga_lancamento(p_user uuid, p_total int, p_minutos int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_usadas int;
begin
  perform pg_advisory_xact_lock(hashtext('oferta_lancamento_vagas'));

  delete from oferta_lancamento_vagas
   where status = 'reservada' and reservada_ate < now();

  select status into v_status from oferta_lancamento_vagas where user_id = p_user;

  if v_status = 'confirmada' then
    return 'confirmada';
  end if;

  if v_status = 'reservada' then
    update oferta_lancamento_vagas
       set reservada_ate = now() + make_interval(mins => p_minutos)
     where user_id = p_user;
    return 'reservada';
  end if;

  select count(*) into v_usadas from oferta_lancamento_vagas;
  if v_usadas >= p_total then
    return 'esgotada';
  end if;

  insert into oferta_lancamento_vagas (user_id, status, reservada_ate)
  values (p_user, 'reservada', now() + make_interval(mins => p_minutos));
  return 'reservada';
end;
$$;

-- Registra a vaga como definitiva. Grava mesmo sem reserva prévia: se a
-- assinatura com preço de lançamento existe, a vaga foi usada.
create or replace function public.confirmar_vaga_lancamento(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into oferta_lancamento_vagas (user_id, status, confirmada_em)
  values (p_user, 'confirmada', now())
  on conflict (user_id) do update
     set status = 'confirmada',
         reservada_ate = null,
         confirmada_em = coalesce(oferta_lancamento_vagas.confirmada_em, now());
end;
$$;

create or replace function public.vagas_lancamento_usadas()
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int
    from oferta_lancamento_vagas
   where status = 'confirmada' or reservada_ate >= now();
$$;

revoke all on function public.reservar_vaga_lancamento(uuid, int, int) from public, anon, authenticated;
revoke all on function public.confirmar_vaga_lancamento(uuid)          from public, anon, authenticated;
revoke all on function public.vagas_lancamento_usadas()                from public, anon, authenticated;
grant execute on function public.reservar_vaga_lancamento(uuid, int, int) to service_role;
grant execute on function public.confirmar_vaga_lancamento(uuid)          to service_role;
grant execute on function public.vagas_lancamento_usadas()                to service_role;

-- 09/10/2026 — Exceção à regra "vaga confirmada nunca volta": quem cancela
-- ainda no teste grátis nunca foi cobrado, e a vaga volta para a fila
-- (chamada por syncSubscriptionToDb em stripe-sync.ts).
create or replace function public.liberar_vaga_lancamento(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from oferta_lancamento_vagas where user_id = p_user;
$$;
revoke all on function public.liberar_vaga_lancamento(uuid) from public, anon, authenticated;
grant execute on function public.liberar_vaga_lancamento(uuid) to service_role;
