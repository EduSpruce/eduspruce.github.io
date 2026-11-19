-- EPISJ 360 0.9.73 · Social360 (redes sociais) — aplicado no projeto episj360 a 19/11/2026
-- Documentos JSON por coleção (espaços, publicações, media, caixa de entrada, modelos, vistas, notificações),
-- com acesso por espaço de trabalho: a Direção (g360_direcao) vê e grava tudo; os outros só os espaços onde
-- estão em dados->members (id = email do Office 365) com a função lá indicada (admin, editor, aprovador).
create table if not exists public.s360_docs(
  col text not null check (col in ('workspaces','posts','media','inbox','templates','views','notifs')),
  id text not null check (length(id) between 1 and 120),
  ws text not null,
  dados jsonb not null,
  t bigint not null default 0,
  por text not null default '',
  atualizado timestamptz not null default now(),
  primary key (col,id),
  check (col <> 'workspaces' or ws = id)
);
create index if not exists s360_docs_ws on public.s360_docs(ws);

create or replace function public.s360_papel(p_ws text) returns text
language sql stable security definer set search_path = public as $$
  select case when g360_direcao() then 'admin'
    else (select m->>'role' from s360_docs w, jsonb_array_elements(coalesce(w.dados->'members','[]'::jsonb)) m
          where w.col = 'workspaces' and w.id = p_ws and g360_email() <> '' and lower(m->>'id') = g360_email() limit 1) end $$;

create or replace function public.s360_acesso() returns boolean
language sql stable security definer set search_path = public as $$
  select g360_direcao() or exists(
    select 1 from s360_docs w, jsonb_array_elements(coalesce(w.dados->'members','[]'::jsonb)) m
    where w.col = 'workspaces' and g360_email() <> '' and lower(m->>'id') = g360_email()) $$;

alter table public.s360_docs enable row level security;
create policy s360_ler on public.s360_docs for select to authenticated using (s360_papel(ws) is not null);
create policy s360_criar on public.s360_docs for insert to authenticated with check (
  case when col = 'workspaces' then g360_direcao() or s360_papel(ws) = 'admin' else s360_papel(ws) is not null end);
create policy s360_mudar on public.s360_docs for update to authenticated
  using (case when col = 'workspaces' then s360_papel(ws) = 'admin' else s360_papel(ws) is not null end)
  with check (case when col = 'workspaces' then s360_papel(ws) = 'admin' else s360_papel(ws) is not null end);
create policy s360_apagar on public.s360_docs for delete to authenticated using (
  case when col = 'workspaces' then s360_papel(ws) = 'admin'
       when col = 'notifs' then s360_papel(ws) is not null
       else s360_papel(ws) in ('admin','editor') end);
revoke all on public.s360_docs from anon;
grant select, insert, update, delete on public.s360_docs to authenticated;
revoke all on function public.s360_papel(text) from anon, public;
revoke all on function public.s360_acesso() from anon, public;
grant execute on function public.s360_papel(text) to authenticated;
grant execute on function public.s360_acesso() to authenticated;
alter publication supabase_realtime add table public.s360_docs;

-- vídeos: armazenamento privado «s360», uma pasta por espaço de trabalho (50 MB por ficheiro)
insert into storage.buckets (id, name, public, file_size_limit) values ('s360','s360',false,52428800) on conflict (id) do nothing;
create policy s360_media_ler on storage.objects for select to authenticated using (bucket_id = 's360' and public.s360_papel(split_part(name,'/',1)) is not null);
create policy s360_media_criar on storage.objects for insert to authenticated with check (bucket_id = 's360' and public.s360_papel(split_part(name,'/',1)) in ('admin','editor'));
create policy s360_media_apagar on storage.objects for delete to authenticated using (bucket_id = 's360' and public.s360_papel(split_part(name,'/',1)) in ('admin','editor'));

-- ===================== EPISJ 360 0.9.75 · Social360 0.3: publicação no Facebook e Instagram =====================
-- Contas ligadas (chaves só no servidor), pedidos de ligação, chave da tarefa agendada e reserva das publicações.
-- Funções do Supabase: s360-meta (ligação OAuth, servidor/s360-meta.ts) e s360-publicar (publicador, servidor/s360-publicar.ts).
-- Segredos das funções: META_APP_ID e META_APP_SECRET (da aplicação da Meta da escola); opcionais META_CONFIG_ID, META_GRAPH_VER.
create table if not exists public.s360_meta(ws text not null, fb_page_id text not null, fb_page_name text not null default '', page_token text not null,
  ig_user_id text, ig_username text, ligado_por text not null default '', ligado_em timestamptz not null default now(),
  estado text not null default 'ok', erro text not null default '', primary key (ws, fb_page_id));
alter table public.s360_meta enable row level security; revoke all on public.s360_meta from anon, authenticated;
create table if not exists public.s360_meta_pedidos(estado text primary key, ws text not null, email text not null, criado timestamptz not null default now());
alter table public.s360_meta_pedidos enable row level security; revoke all on public.s360_meta_pedidos from anon, authenticated;
create table if not exists public.s360_cfg(k text primary key, v text not null);
alter table public.s360_cfg enable row level security; revoke all on public.s360_cfg from anon, authenticated;
insert into public.s360_cfg(k, v) values ('cron', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (k) do nothing;
-- s360_meta_listar(ws) e s360_meta_desligar(ws, fb): só administradores do espaço; s360_reservar(max): só o servidor (service_role)
-- (definições completas na migração social360_meta do projeto episj360)
select cron.schedule('episj360-s360-publicar', '* * * * *', $cron$
  select net.http_post(url := 'https://oovqekytlhkbinfdxjwf.supabase.co/functions/v1/s360-publicar', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','x-s360-chave',(select v from public.s360_cfg where k='cron')), timeout_milliseconds := 60000)
$cron$);
