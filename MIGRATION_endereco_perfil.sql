-- Endereço do responsável em `profiles` — usado na nota fiscal de quem assina.
-- Colunas opcionais: parceiro convidado não assina e não precisa informar.
-- A exigência fica no app (cadastro de quem não veio por convite + checkout).
-- A RLS existente de `profiles` (própria linha) já cobre as colunas novas.

alter table public.profiles
  add column if not exists address_cep        text,
  add column if not exists address_street     text,
  add column if not exists address_number     text,
  add column if not exists address_complement text,
  add column if not exists address_district   text,
  add column if not exists address_city       text,
  add column if not exists address_state      text;

alter table public.profiles
  drop constraint if exists profiles_address_cep_fmt,
  add  constraint profiles_address_cep_fmt   check (address_cep is null or address_cep ~ '^[0-9]{8}$'),
  drop constraint if exists profiles_address_state_fmt,
  add  constraint profiles_address_state_fmt check (address_state is null or address_state ~ '^[A-Z]{2}$');
