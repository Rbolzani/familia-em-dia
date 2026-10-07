-- Painel do negócio (/admin): contagens de uso por usuário.
-- Devolve só números e um sinal de uso da IA — nunca conteúdo (nomes de
-- filhos, atividades, documentos). Executável apenas pelo service_role: o
-- painel chama pelo servidor depois de conferir que quem pede é fundador.

create or replace function public.admin_uso_por_usuario()
returns table(user_id uuid, filhos bigint, atividades bigint, usou_ia boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         (select count(*) from public.children c where c.user_id = u.id),
         (select count(*) from public.activities a where a.user_id = u.id),
         (exists (select 1 from public.activities a where a.user_id = u.id and a.ai_generated)
          or exists (select 1 from public.documents d where d.user_id = u.id and d.ocr_text is not null))
  from auth.users u
$$;

revoke all on function public.admin_uso_por_usuario() from public, anon, authenticated;
grant execute on function public.admin_uso_por_usuario() to service_role;
