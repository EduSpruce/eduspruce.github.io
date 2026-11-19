-- =====================================================================================
--  EPISJ 360 — base de dados no Supabase (fase 1 da transição)
--  Correr UMA vez em: Supabase › projeto da EPISJ 360 › SQL Editor › New query › colar tudo › Run
--  Pode voltar a correr sem perder dados (só cria o que falta).
--
--  Fase 1: o "estado" da app (configuração, escola, planos curriculares, formadores, reservas,
--  horários, avisos, análises da Box) passa da nuvem da Cloudflare para aqui, em peças com nome
--  (as mesmas da nuvem antiga: estado, rc, ES, avisos, L_<pasta>, B_<pasta>…).
--  Cada vez que uma peça muda, a versão anterior fica guardada no histórico — nada se perde.
--  Fases seguintes: tabelas próprias para turmas, planos, reservas… e atualização em tempo real.
--
--  Quem entra: contas do Office 365 da escola (login "Azure" do Supabase).
--  Quem pode o quê: tabela g360_membros (Direção e administradores leem e gravam tudo;
--  formadores e formandos só leem o que a Direção publica, na peça "publico").
-- =====================================================================================

-- ---------- membros e perfis ----------
create table if not exists public.g360_membros (
  email       text primary key,                 -- email da escola, em minúsculas
  nome        text,
  perfil      text not null default 'prof' check (perfil in ('dexec','dped','prof','form')),
  admin       boolean not null default false,
  turma       text,                             -- para formandos
  atualizado  timestamptz not null default now()
);

-- primeiro administrador: quem entrar primeiro e chamar g360_reclamar_admin() enquanto não houver nenhum administrador
-- (só contas do Office 365 da escola conseguem entrar; a app chama isto sozinha depois do primeiro login do diretor)

-- ---------- peças do estado da app ----------
create table if not exists public.g360_estado (
  nome        text primary key,                 -- estado, rc, ES, avisos, L_<pasta>, B_<pasta>, publico…
  dados       text not null,                    -- conteúdo comprimido (gzip) em base64, como a app o envia
  t           bigint not null default 0,        -- momento da alteração (ms), usado para juntar sem perder nada
  por         text,                             -- email de quem gravou
  atualizado  timestamptz not null default now()
);

-- ---------- histórico: cada versão substituída fica aqui ----------
create table if not exists public.g360_historico (
  id          bigserial primary key,
  nome        text not null,
  dados       text not null,
  t           bigint not null,
  por         text,
  guardado    timestamptz not null default now()
);
create index if not exists g360_historico_nome on public.g360_historico (nome, guardado desc);

create or replace function public.g360_guardar_historico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.dados is distinct from new.dados then
    insert into public.g360_historico (nome, dados, t, por) values (old.nome, old.dados, old.t, old.por);
  end if;
  new.atualizado := now();
  return new;
end $$;

drop trigger if exists g360_estado_hist on public.g360_estado;
create trigger g360_estado_hist before update on public.g360_estado
  for each row execute function public.g360_guardar_historico();

-- ---------- quem sou eu (a partir do login) ----------
create or replace function public.g360_email() returns text
language sql stable set search_path = public as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.g360_direcao() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.g360_membros m
                 where m.email = public.g360_email() and (m.admin or m.perfil in ('dexec','dped')))
$$;

create or replace function public.g360_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.g360_membros m where m.email = public.g360_email() and m.admin)
$$;

create or replace function public.g360_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.g360_membros m where m.email = public.g360_email())
$$;

-- ---------- regras de acesso (RLS) ----------
alter table public.g360_membros   enable row level security;
alter table public.g360_estado    enable row level security;
alter table public.g360_historico enable row level security;

drop policy if exists "membros: ver o próprio ou direção" on public.g360_membros;
create policy "membros: ver o próprio ou direção" on public.g360_membros
  for select to authenticated using (email = public.g360_email() or public.g360_direcao());

drop policy if exists "membros: administradores gerem" on public.g360_membros;
create policy "membros: administradores gerem" on public.g360_membros
  for all to authenticated using (public.g360_admin()) with check (public.g360_admin());

drop policy if exists "estado: direção lê tudo, os outros só o publicado" on public.g360_estado;
create policy "estado: direção lê tudo, os outros só o publicado" on public.g360_estado
  for select to authenticated using (public.g360_direcao() or (nome = 'publico' and public.g360_membro()));

drop policy if exists "estado: direção grava" on public.g360_estado;
create policy "estado: direção grava" on public.g360_estado
  for insert to authenticated with check (public.g360_direcao());

drop policy if exists "estado: direção atualiza" on public.g360_estado;
create policy "estado: direção atualiza" on public.g360_estado
  for update to authenticated using (public.g360_direcao()) with check (public.g360_direcao());
-- (não há regra de apagar: ninguém apaga peças pela app)

drop policy if exists "histórico: direção lê" on public.g360_historico;
create policy "histórico: direção lê" on public.g360_historico
  for select to authenticated using (public.g360_direcao());

grant select, insert, update on public.g360_estado to authenticated;
grant select on public.g360_historico to authenticated;
grant select, insert, update, delete on public.g360_membros to authenticated;

create or replace function public.g360_reclamar_admin() returns boolean
language plpgsql security definer set search_path = public as $$
declare em text := public.g360_email(); nm text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', '');
begin
  if em = '' then return false; end if;
  if exists (select 1 from public.g360_membros where admin) then
    return exists (select 1 from public.g360_membros where email = em and admin);
  end if;
  insert into public.g360_membros (email, nome, perfil, admin) values (em, nm, 'dexec', true)
    on conflict (email) do update set admin = true, perfil = 'dexec';
  return true;
end $$;
revoke all on function public.g360_reclamar_admin() from public, anon;
grant execute on function public.g360_reclamar_admin() to authenticated;
