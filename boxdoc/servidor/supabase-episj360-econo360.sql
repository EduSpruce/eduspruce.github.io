-- EPISJ 360 0.9.116 — Econo360 (economato da escola profissional)
-- O stock, os artigos, os movimentos, as compras e os inventários ficam na peça «EC» de g360_estado (só a Direção).
-- Estas duas tabelas servem para os formadores: ver o catálogo e fazer as suas requisições de material.
-- Nada se apaga: não há políticas de DELETE (uma requisição cancela-se ou recusa-se, mas fica registada).

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
create policy eco_cat_inserir on public.eco_cat for insert to authenticated with check (public.g360_direcao());
create policy eco_cat_mudar on public.eco_cat for update to authenticated using (public.g360_direcao()) with check (public.g360_direcao());

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
  using (email = public.g360_email() or public.g360_direcao());
create policy eco_req_criar on public.eco_req for insert to authenticated
  with check (public.g360_direcao() or (public.g360_membro() and public.g360_email() <> '' and email = public.g360_email() and estado = 'pendente'));
-- o formador só mexe nas suas enquanto estão pendentes (pode corrigir ou cancelar)
create policy eco_req_mudar_formador on public.eco_req for update to authenticated
  using (email = public.g360_email() and estado = 'pendente')
  with check (email = public.g360_email() and estado in ('pendente','cancelada'));
create policy eco_req_mudar_direcao on public.eco_req for update to authenticated
  using (public.g360_direcao()) with check (public.g360_direcao());

create or replace function public.eco_req_carimbo() returns trigger language plpgsql set search_path = public as $$
begin
  new.t := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  new.por := public.g360_email();
  if tg_op = 'INSERT' then new.criado := now();
  else new.id := old.id; new.criado := old.criado;
    if not public.g360_direcao() then new.email := old.email; new.resp := old.resp; end if;
  end if;
  return new;
end $$;
drop trigger if exists eco_req_carimbo on public.eco_req;
create trigger eco_req_carimbo before insert or update on public.eco_req for each row execute function public.eco_req_carimbo();

grant select, insert, update on public.eco_req to authenticated;
grant select, insert, update on public.eco_cat to authenticated;
revoke all on public.eco_req from anon;
revoke all on public.eco_cat from anon;
