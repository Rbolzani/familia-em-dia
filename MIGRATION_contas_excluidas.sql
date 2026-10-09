-- Registro anônimo de contas excluídas (08/10/2026)
--
-- Excluir a conta apaga tudo da pessoa — e, com isso, ela sumia de todos os
-- números do Painel do negócio, como se nunca tivesse existido. Esta tabela
-- guarda só a CONTAGEM: quando saiu, há quantos dias a conta existia e em que
-- situação estava. Nada aqui identifica alguém (sem id, nome, e-mail ou
-- telefone), então o registro sobrevive à exclusão sem contrariar o pedido.
--
-- Gravada por /api/account/delete depois de a conta ser apagada.
-- Tabela só do servidor: RLS ligada e nenhuma policy.

create table if not exists public.contas_excluidas (
  id            uuid primary key default gen_random_uuid(),
  excluida_em   timestamptz not null default now(),
  dias_de_conta integer not null check (dias_de_conta >= 0),
  situacao      text not null check (situacao in ('teste','pagante','gratuito','cortesia')),
  tinha_filho   boolean not null default false,
  convidado     boolean not null default false,
  origem        text
);

alter table public.contas_excluidas enable row level security;
revoke all on public.contas_excluidas from anon, authenticated;

-- Conta rbolzanic (criada em 07/10/2026, em teste, sem filho), excluída pelo
-- próprio dono em 08/10 antes de o registro existir. Hora aproximada.
insert into public.contas_excluidas (excluida_em, dias_de_conta, situacao, tinha_filho, convidado, origem)
values ('2026-10-08 22:00:00+00', 1, 'teste', false, false, 'Instagram');
