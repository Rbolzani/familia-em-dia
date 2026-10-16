-- Aviso de fim do teste grátis (16/10/2026)
--
-- Uma linha por pessoa que já recebeu o aviso "seu teste termina em 3 dias".
-- A chave primária em user_id garante UM aviso por conta: a rotina
-- (/api/cron/aviso-fim-teste) grava a linha ANTES de enviar e, se outra
-- execução chegar junto, a segunda gravação falha e ela não envia. Se nenhum
-- canal entregar, a linha é apagada e a rotina tenta de novo no dia seguinte.
--
-- Tabela só do servidor: RLS ligada e nenhuma policy — apenas a chave de
-- serviço lê e escreve.

create table if not exists public.aviso_fim_teste (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enviado_em timestamptz not null default now(),
  -- fim do teste no momento do aviso, para o painel e para auditoria
  fim_teste  timestamptz,
  whatsapp   boolean not null default false,
  email      boolean not null default false
);

alter table public.aviso_fim_teste enable row level security;

revoke all on public.aviso_fim_teste from anon, authenticated;
