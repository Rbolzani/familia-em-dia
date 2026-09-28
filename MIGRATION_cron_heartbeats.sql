-- "Batimento" dos crons — U6 (parte B) da bateria de prontidão.
--
-- POR QUE
-- O webhook de status (MIGRATION_whatsapp_status_entrega.sql) avisa quando a
-- Meta REJEITA uma entrega — mas isso é um erro, e todo erro loga. O buraco é
-- outro: em set/2026 o cron externo (cron-job.org) parou de bater com o
-- CRON_SECRET certo e o endpoint /api/whatsapp-daily simplesmente nunca mais
-- foi chamado. Nenhum erro aconteceu — nada rodou, então nada teve como
-- falhar, e o Sentry não tem do que reclamar. Só dá pra pegar isso comparando
-- "quando foi a última vez que isto rodou" com "quanto tempo é razoável
-- passar sem rodar".
--
-- Uma linha por cron, sobrescrita a cada execução. Só o service role
-- lê/escreve: RLS ligada e SEM policies (mesmo padrão de whatsapp_messages).

create table if not exists public.cron_heartbeats (
  name    text primary key,        -- 'whatsapp-daily' | 'expire-trials'
  ran_at  timestamptz not null default now(),
  result  jsonb
);

alter table public.cron_heartbeats enable row level security;
