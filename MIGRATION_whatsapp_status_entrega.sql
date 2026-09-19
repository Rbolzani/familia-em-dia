-- Status de entrega das mensagens de WhatsApp.
--
-- POR QUE
-- A Meta responde 200 ao ENVIO e só depois decide se ENTREGA. Quando a
-- entrega falha (cartão da WABA recusado, número inválido, limite), o aviso
-- chega apenas pelo webhook de status. Sem ele o app não tinha como saber:
-- em set/2026 o resumo diário parou de chegar por 2 dias por "pagamento
-- atrasado" na Meta, e o único sinal foi o dono não receber a mensagem.
--
-- Uma linha por mensagem (wamid = ID devolvido pela Meta no envio).
-- Só o service role lê/escreve: RLS ligada e SEM policies.

create table if not exists public.whatsapp_messages (
  wamid        text primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  kind         text,               -- resumo | teste | grace | logistica
  template     text,
  status       text not null default 'accepted',  -- accepted|sent|delivered|read|failed
  error_code   int,
  error_title  text,
  error_detail text,
  sent_at      timestamptz not null default now(),
  status_at    timestamptz
);

create index if not exists whatsapp_messages_status_idx on public.whatsapp_messages (status, sent_at desc);
create index if not exists whatsapp_messages_user_idx   on public.whatsapp_messages (user_id, sent_at desc);

alter table public.whatsapp_messages enable row level security;
