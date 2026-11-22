-- EPISJ 360 0.9.116–0.9.117 — Econo360 (economato da escola profissional) + perfil «Economato»
-- O stock, os artigos, os movimentos, as compras e os inventários ficam na peça «EC» de g360_estado.
-- Quem mexe no economato: a Direção e as contas com o perfil «Economato» (0.9.117), que só veem o Econo360.
-- As tabelas eco_req e eco_cat servem para os formadores verem o catálogo e fazerem as suas requisições.
-- Nada se apaga: não há políticas de DELETE (uma requisição cancela-se ou recusa-se, mas fica registada).

-- 0.9.117: perfil «Economato» (econ) — só os separadores do Econo360
create or replace function public.g360_const() returns jsonb language sql immutable set search_path to 'public' as $c$ select '{
  "perfis": {"dexec":"Direção Executiva","dped":"Direção Pedagógica","prof":"Formador","form":"Formando","econ":"Economato"},
  "separadores": ["esc","anos","cal","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","cop","meu","esch","mh","rcMapa","rcLista","rcEsp","crPs","crCron","crCump","crHist","crDef","ecoInicio","ecoMovs","ecoReq","ecoCompras","ecoInv","ecoCustos","ecoDef","def"],
  "modTabs": {"escola":["esc","anos","cal","cur","tur","pc","prof","dsd","for"],"boxcheck":["box","alt","pas","config","rel","est","env","pra","cop","meu"],"eduschedule":["esch","mh"],"roomcheck":["rcMapa","rcLista","rcEsp"],"crono":["crPs","crCron","crCump","crHist","crDef"],"econo":["ecoInicio","ecoMovs","ecoReq","ecoCompras","ecoInv","ecoCustos","ecoDef"]},
  "visOmissao": {
    "dexec": ["esc","anos","cal","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","cop","meu","esch","mh","rcMapa","rcLista","rcEsp","crPs","crCron","crCump","crHist","crDef","def"],
    "dped": ["esc","anos","cal","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","meu","esch","mh","rcMapa","rcLista","rcEsp","crPs","crCron","crCump","crHist","crDef"],
    "prof": ["meu","mh","dsd","cal","crPs","crCron","crHist"],
    "form": ["mh","cal"],
    "econ": ["ecoInicio","ecoMovs","ecoReq","ecoCompras","ecoInv","ecoCustos","ecoDef"]}
}'::jsonb $c$;

-- o perfil atribuído em Utilizadores e perfis pode ser «econ»
do $d$ declare f text; begin
  select pg_get_functiondef('public.g360_perfil_de'::regproc) into f;
  if position('''econ''' in f) = 0 then
    f := replace(f, $x$in ('dexec','dped','prof','form')$x$, $x$in ('dexec','dped','prof','form','econ')$x$);
    execute f;
  end if;
end $d$;

-- Direção ou Economato
create or replace function public.g360_economato() returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce(public.g360_direcao() or (public.g360_perfil_de(public.g360_email()) ->> 'perfil') = 'econ', false) $f$;

-- a peça «EC» (Econo360) também pode ser lida e gravada pelo Economato
drop policy if exists "estado: economato lê EC" on public.g360_estado;
drop policy if exists "estado: economato grava EC" on public.g360_estado;
drop policy if exists "estado: economato atualiza EC" on public.g360_estado;
create policy "estado: economato lê EC" on public.g360_estado for select to authenticated using (nome = 'EC' and public.g360_economato());
create policy "estado: economato grava EC" on public.g360_estado for insert to authenticated with check (nome = 'EC' and public.g360_economato());
create policy "estado: economato atualiza EC" on public.g360_estado for update to authenticated using (nome = 'EC' and public.g360_economato()) with check (nome = 'EC' and public.g360_economato());

-- catálogo para os formadores (uma linha, escrita pela Direção quando os artigos mudam)
create table if not exists public.eco_cat (
  k text primary key,
  dados jsonb not null default '[]'::jsonb,
  t bigint not null default 0,
  por text not null default ''
);
alter table public.eco_cat enable row level security;
drop policy if exists eco_cat_ler on public.eco_cat;
drop policy if exists eco_cat_inserir on public.eco_cat;
drop policy if exists eco_cat_mudar on public.eco_cat;
create policy eco_cat_ler on public.eco_cat for select to authenticated using (public.g360_membro());
create policy eco_cat_inserir on public.eco_cat for insert to authenticated with check (public.g360_economato());
create policy eco_cat_mudar on public.eco_cat for update to authenticated using (public.g360_economato()) with check (public.g360_economato());

-- requisições de material
create table if not exists public.eco_req (
  id text primary key,
  email text not null,                 -- quem pede (o formador)
  nome text not null default '',
  dados jsonb not null default '{}'::jsonb, -- {turmaId, turma, fse, curso, ufcd, para, linhas:[{art,cod,nome,q,un}], obs}
  estado text not null default 'pendente' check (estado in ('pendente','aprovada','recusada','entregue','cancelada')),
  resp jsonb not null default '{}'::jsonb,  -- {por, msg, t, mov:[ids dos movimentos de saída]}
  criado timestamptz not null default now(),
  t bigint not null default 0,
  por text not null default ''
);
alter table public.eco_req enable row level security;
create index if not exists eco_req_email on public.eco_req(email);
drop policy if exists eco_req_ler on public.eco_req;
drop policy if exists eco_req_criar on public.eco_req;
drop policy if exists eco_req_mudar_formador on public.eco_req;
drop policy if exists eco_req_mudar_direcao on public.eco_req;
create policy eco_req_ler on public.eco_req for select to authenticated
  using (email = public.g360_email() or public.g360_economato());
create policy eco_req_criar on public.eco_req for insert to authenticated
  with check (public.g360_economato() or (public.g360_membro() and public.g360_email() <> '' and email = public.g360_email() and estado = 'pendente'));
-- o formador só mexe nas suas enquanto estão pendentes (pode corrigir ou cancelar)
create policy eco_req_mudar_formador on public.eco_req for update to authenticated
  using (email = public.g360_email() and estado = 'pendente')
  with check (email = public.g360_email() and estado in ('pendente','cancelada'));
create policy eco_req_mudar_direcao on public.eco_req for update to authenticated
  using (public.g360_economato()) with check (public.g360_economato());

create or replace function public.eco_req_carimbo() returns trigger language plpgsql set search_path = public as $$
begin
  new.t := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  new.por := public.g360_email();
  if tg_op = 'INSERT' then new.criado := now();
  else new.id := old.id; new.criado := old.criado;
    if not public.g360_economato() then new.email := old.email; new.resp := old.resp; end if;
  end if;
  return new;
end $$;
drop trigger if exists eco_req_carimbo on public.eco_req;
create trigger eco_req_carimbo before insert or update on public.eco_req for each row execute function public.eco_req_carimbo();

grant select, insert, update on public.eco_req to authenticated;
grant select, insert, update on public.eco_cat to authenticated;
revoke all on public.eco_req from anon;
revoke all on public.eco_cat from anon;
