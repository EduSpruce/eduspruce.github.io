-- =====================================================================================
--  EPISJ 360 — Supabase, fase 3 (0.9.50)
--  · g360_box: cofre da ligação à Box de cada conta da Direção. Só a própria conta lê a sua linha (pelas funções);
--    um computador de cada vez renova (g360_box_reclamar) e o Supabase renova-a todos os dias (função box-manter,
--    agendada no pg_cron) para nunca caducar por falta de uso. Nada disto é visível a formadores ou formandos.
--  · g360_prefs: preferências de cada pessoa (widgets do Painel e disposição dos quadros), iguais em todos os aparelhos,
--    em tempo real. Cada conta só lê e escreve a sua linha.
--  (aplicado pelo Claude por migração; guardado aqui para referência)
-- =====================================================================================

create table if not exists public.g360_box (
  email        text primary key,
  a            text,
  r            text not null,
  exp          bigint,
  t            bigint not null default 0,
  login        text,
  nome         text,
  bloqueio_ate bigint not null default 0,
  morta        boolean not null default false,
  erro         text,
  renovada     timestamptz,
  atualizado   timestamptz not null default now()
);
alter table public.g360_box enable row level security;
revoke all on public.g360_box from anon, authenticated;   -- só pelas funções abaixo (e pelo serviço do Supabase)

create or replace function public.g360_box_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := g360_email(); x record;
begin
  if e = '' or not g360_direcao() then raise exception 'Só a Direção guarda a ligação à Box.' using errcode = '42501'; end if;
  select * into x from g360_box where email = e;
  if not found then return null; end if;
  return jsonb_build_object('a', x.a, 'r', x.r, 'exp', x.exp, 't', x.t, 'login', x.login, 'nome', x.nome, 'morta', x.morta);
end $$;

-- guarda a sessão mais recente; se o cofre já tiver uma mais nova (de outro computador ou da renovação diária), devolve-a
create or replace function public.g360_box_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := g360_email(); nt bigint := coalesce(nullif(p->>'t','')::bigint, 0); x record;
begin
  if e = '' or not g360_direcao() then raise exception 'Só a Direção guarda a ligação à Box.' using errcode = '42501'; end if;
  if coalesce(p->>'r', '') = '' then raise exception 'Falta o código de renovação da Box.'; end if;
  select * into x from g360_box where email = e for update;
  if found and x.r is distinct from (p->>'r') and x.t > nt and not x.morta then
    return jsonb_build_object('ok', false, 'a', x.a, 'r', x.r, 'exp', x.exp, 't', x.t, 'login', x.login, 'nome', x.nome);
  end if;
  insert into g360_box (email, a, r, exp, t, login, nome, bloqueio_ate, morta, erro, atualizado)
    values (e, p->>'a', p->>'r', nullif(p->>'exp','')::bigint, greatest(nt, 1), nullif(p->>'login',''), nullif(p->>'nome',''), 0, false, null, now())
  on conflict (email) do update set
    a = excluded.a, r = excluded.r, exp = excluded.exp,
    t = case when g360_box.r = excluded.r then greatest(g360_box.t, excluded.t) else excluded.t end,
    login = coalesce(excluded.login, g360_box.login), nome = coalesce(excluded.nome, g360_box.nome),
    bloqueio_ate = 0, morta = false, erro = null, atualizado = now();
  return jsonb_build_object('ok', true);
end $$;

-- só um computador renova de cada vez: quem reclama fica com a vez durante alguns segundos; os outros esperam ou usam a mais recente
create or replace function public.g360_box_reclamar(p_r text, p_ms int default 20000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := g360_email(); agora bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; x record;
begin
  if e = '' or not g360_direcao() then raise exception 'Só a Direção guarda a ligação à Box.' using errcode = '42501'; end if;
  select * into x from g360_box where email = e for update;
  if not found then return jsonb_build_object('ok', true, 'novo', true); end if;
  if x.r is distinct from p_r then
    return jsonb_build_object('ok', false, 'a', x.a, 'r', x.r, 'exp', x.exp, 't', x.t, 'login', x.login, 'morta', x.morta);
  end if;
  if x.bloqueio_ate > agora then return jsonb_build_object('ok', false, 'espera', x.bloqueio_ate - agora); end if;
  update g360_box set bloqueio_ate = agora + greatest(3000, least(coalesce(p_ms, 20000), 60000)) where email = e;
  return jsonb_build_object('ok', true);
end $$;

-- a Box recusou este código: fica marcado (os outros aparelhos sabem que é preciso voltar a ligar)
create or replace function public.g360_box_morta(p_r text, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := g360_email();
begin
  if e = '' or not g360_direcao() then return; end if;
  update g360_box set morta = true, erro = left(coalesce(p_erro, ''), 300), bloqueio_ate = 0, atualizado = now()
   where email = e and r = p_r;
end $$;

-- «Desligar a Box» (pedido pelo próprio): tira a ligação do cofre
create or replace function public.g360_box_esquecer() returns void
language plpgsql security definer set search_path = public as $$
declare e text := g360_email();
begin
  if e = '' then return; end if;
  update g360_box set r = '-', a = null, morta = true, erro = 'desligada pelo próprio', atualizado = now() where email = e;
end $$;

revoke all on function public.g360_box_ler() from public, anon;
revoke all on function public.g360_box_guardar(jsonb) from public, anon;
revoke all on function public.g360_box_reclamar(text, int) from public, anon;
revoke all on function public.g360_box_morta(text, text) from public, anon;
revoke all on function public.g360_box_esquecer() from public, anon;
grant execute on function public.g360_box_ler() to authenticated;
grant execute on function public.g360_box_guardar(jsonb) to authenticated;
grant execute on function public.g360_box_reclamar(text, int) to authenticated;
grant execute on function public.g360_box_morta(text, text) to authenticated;
grant execute on function public.g360_box_esquecer() to authenticated;

-- preferências de cada pessoa (widgets e disposição dos quadros)
create table if not exists public.g360_prefs (
  email      text primary key,
  dados      jsonb not null default '{}'::jsonb,
  t          bigint not null default 0,
  por        text,
  atualizado timestamptz not null default now()
);
alter table public.g360_prefs enable row level security;
revoke all on public.g360_prefs from anon;
grant select, insert, update on public.g360_prefs to authenticated;
create policy g360_prefs_ler on public.g360_prefs for select to authenticated using (email = public.g360_email());
create policy g360_prefs_inserir on public.g360_prefs for insert to authenticated with check (public.g360_email() <> '' and email = public.g360_email());
create policy g360_prefs_mudar on public.g360_prefs for update to authenticated using (email = public.g360_email()) with check (email = public.g360_email());
create or replace function public.g360_prefs_data() returns trigger language plpgsql set search_path = public as $$
begin new.atualizado := now(); return new; end $$;
create or replace trigger g360_prefs_data before insert or update on public.g360_prefs for each row execute function public.g360_prefs_data();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'g360_prefs') then
    alter publication supabase_realtime add table public.g360_prefs;
  end if;
end $$;

-- g360_direcao() devolvia NULL (em vez de false) para contas sem perfil: "if not g360_direcao()" deixava-as passar
-- (por exemplo em g360_publico_gravar). Agora devolve sempre true ou false.
create or replace function public.g360_direcao() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           coalesce((g360_perfil_de(g360_email()) ->> 'admin')::boolean, false)
           or coalesce((g360_perfil_de(g360_email()) ->> 'perfil') in ('dexec','dped'), false),
         false) $$;

-- renovação diária da ligação à Box (função box-manter, código em servidor/box-manter.ts)
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule(
  'episj360-box-manter',
  '41 3 * * *',
  $$select net.http_post(
      url := 'https://oovqekytlhkbinfdxjwf.supabase.co/functions/v1/box-manter',
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 60000)$$
);

-- 0.9.58: separadores novos — Calendário Escolar (Escola360) e o módulo Crono360 (cronogramas e pontos de situação)
create or replace function public.g360_const() returns jsonb
language sql immutable set search_path = public as $$ select '{
  "perfis": {"dexec":"Direção Executiva","dped":"Direção Pedagógica","prof":"Formador","form":"Formando"},
  "separadores": ["esc","anos","cal","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","cop","meu","esch","mh","rcMapa","rcLista","rcEsp","crPs","crCron","crCump","crHist","crDef","def"],
  "modTabs": {"escola":["esc","anos","cal","cur","tur","pc","prof","dsd","for"],"boxcheck":["box","alt","pas","config","rel","est","env","pra","cop","meu"],"eduschedule":["esch","mh"],"roomcheck":["rcMapa","rcLista","rcEsp"],"crono":["crPs","crCron","crCump","crHist","crDef"]},
  "visOmissao": {
    "dexec": ["esc","anos","cal","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","cop","meu","esch","mh","rcMapa","rcLista","rcEsp","crPs","crCron","crCump","crHist","crDef","def"],
    "dped": ["esc","anos","cal","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","meu","esch","mh","rcMapa","rcLista","rcEsp","crPs","crCron","crCump","crHist","crDef"],
    "prof": ["meu","mh","dsd","cal","crPs","crCron","crHist"],
    "form": ["mh","cal"]}
}'::jsonb $$;
