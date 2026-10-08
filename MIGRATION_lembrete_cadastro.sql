-- Lembrete de cadastro incompleto (08/10/2026)
--
-- Uma linha por pessoa que já recebeu o e-mail "faltou só um passo". A chave
-- primária em user_id é o que garante UM lembrete por conta: a rotina
-- (/api/cron/lembrete-cadastro) grava a linha ANTES de enviar e, se outra
-- execução chegar junto, a segunda gravação falha e ela não envia.
--
-- Tabela só do servidor: RLS ligada e nenhuma policy — apenas a chave de
-- serviço lê e escreve.

create table if not exists public.cadastro_lembretes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enviado_em timestamptz not null default now()
);

alter table public.cadastro_lembretes enable row level security;

revoke all on public.cadastro_lembretes from anon, authenticated;
