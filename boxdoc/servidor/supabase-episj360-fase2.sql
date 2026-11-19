-- =====================================================================================
--  EPISJ 360 — Supabase, fase 2: entrada única com o Office 365 e perfis na base de dados
--  (aplicado pelo Claude por migração; guardado aqui para referência)
--  · g360_config: perfis (administradores, utilizadores com perfil atribuído, regra dos formandos,
--    separadores visíveis por perfil, módulos desligados) e a lista de formadores publicada.
--  · g360_eu(): o perfil de quem entrou, calculado no servidor (as mesmas regras do serviço antigo):
--      1) perfil atribuído na lista; 2) administradores → Direção Executiva;
--      3) email entre os formadores publicados → Formador; 4) regra dos formandos → Formando.
--  · g360_publico_ler(): o que a Direção publicou, filtrado por perfil (formandos sem emails).
--  · As regras de acesso (RLS) passam a usar este perfil.
-- =====================================================================================

create table if not exists public.g360_config (
  chave      text primary key,
  valor      jsonb not null default '{}'::jsonb,
  t          bigint not null default 0,
  por        text,
  atualizado timestamptz not null default now()
);
alter table public.g360_config enable row level security;
revoke all on public.g360_config from anon, authenticated;   -- só pelas funções abaixo

create table if not exists public.g360_config_historico (
  id bigserial primary key, chave text not null, valor jsonb not null, t bigint, por text, guardado timestamptz not null default now()
);
alter table public.g360_config_historico enable row level security;
revoke all on public.g360_config_historico from anon, authenticated;

create or replace function public.g360_config_hist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.valor is distinct from new.valor then
    insert into public.g360_config_historico (chave, valor, t, por) values (old.chave, old.valor, old.t, old.por);
  end if;
  new.atualizado := now(); return new;
end $$;
drop trigger if exists g360_config_hist on public.g360_config;
create trigger g360_config_hist before update on public.g360_config for each row execute function public.g360_config_hist();
revoke all on function public.g360_config_hist() from public, anon, authenticated;

-- constantes (as mesmas da app)
create or replace function public.g360_const() returns jsonb
language sql immutable set search_path = public as $$ select '{
  "perfis": {"dexec":"Direção Executiva","dped":"Direção Pedagógica","prof":"Formador","form":"Formando"},
  "separadores": ["esc","anos","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","cop","meu","esch","mh","rcMapa","rcLista","rcEsp","def"],
  "modTabs": {"escola":["esc","anos","cur","tur","pc","prof","dsd","for"],"boxcheck":["box","alt","pas","config","rel","est","env","pra","cop","meu"],"eduschedule":["esch","mh"],"roomcheck":["rcMapa","rcLista","rcEsp"]},
  "visOmissao": {
    "dexec": ["esc","anos","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","cop","meu","esch","mh","rcMapa","rcLista","rcEsp","def"],
    "dped": ["esc","anos","cur","tur","pc","prof","dsd","for","box","alt","pas","config","rel","est","env","pra","meu","esch","mh","rcMapa","rcLista","rcEsp"],
    "prof": ["meu","mh","dsd"],
    "form": ["mh"]}
}'::jsonb $$;

-- perfil de um email (núcleo das regras)
create or replace function public.g360_perfil_de(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email,'')));
  loja jsonb := coalesce((select valor from g360_config where chave = 'perfis'), '{}'::jsonb);
  profs jsonb := coalesce((select valor from g360_config where chave = 'profs'), '[]'::jsonb);
  m record; u jsonb; perfil text; origem text := ''; adm boolean := false; turma text := ''; nome text := '';
  dom text := split_part(e, '@', 2); padrao text := coalesce(loja #>> '{formandos,padrao}', '');
  c jsonb := g360_const(); vis jsonb; off jsonb;
begin
  if e = '' then return jsonb_build_object('perfil', null); end if;
  select * into m from g360_membros where email = e;
  adm := coalesce(m.admin, false) or coalesce(loja -> 'admins', '[]'::jsonb) ? e;
  u := loja -> 'utilizadores' -> e;
  if u is not null and (u ->> 'perfil') in ('dexec','dped','prof','form') then
    perfil := u ->> 'perfil'; origem := 'atribuído'; turma := coalesce(u ->> 'turma',''); nome := coalesce(u ->> 'nome','');
  elsif m.email is not null and not coalesce(m.admin,false) and m.perfil is not null then
    perfil := m.perfil; origem := 'atribuído'; turma := coalesce(m.turma,''); nome := coalesce(m.nome,'');
  end if;
  if perfil is null and adm then perfil := 'dexec'; origem := 'administrador'; end if;
  if perfil is null and exists (select 1 from jsonb_array_elements(profs) x where lower(x ->> 'email') = e) then
    perfil := 'prof'; origem := 'formador da EPISJ 360';
  end if;
  if perfil is null and ((coalesce(loja #> '{formandos,dominios}', '[]'::jsonb) ? dom)
                          or (padrao <> '' and e ~* padrao)) then
    perfil := 'form'; origem := 'regra dos formandos';
  end if;
  if perfil is null then return jsonb_build_object('email', e, 'perfil', null); end if;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into off
    from jsonb_array_elements_text(coalesce(loja -> 'modsOff', '[]'::jsonb)) mo, jsonb_array_elements_text(c -> 'modTabs' -> mo) t;
  if adm then vis := (c -> 'separadores') || '["uti"]'::jsonb;
  else
    select coalesce(jsonb_agg(t), '[]'::jsonb) into vis
      from jsonb_array_elements_text(coalesce(loja -> 'vis' -> perfil, c -> 'visOmissao' -> perfil)) t
      where not (off ? t);
  end if;
  return jsonb_build_object('email', e, 'nome', nome, 'perfil', perfil, 'perfilNome', c -> 'perfis' ->> perfil, 'origem', origem,
    'admin', adm, 'vis', vis, 'modsOff', coalesce(loja -> 'modsOff', '[]'::jsonb), 'turma', turma);
end $$;
revoke all on function public.g360_perfil_de(text) from public, anon, authenticated;

-- quem sou eu
create or replace function public.g360_eu() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := g360_perfil_de(g360_email());
        nm text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', '');
begin
  if coalesce(r ->> 'nome','') = '' then r := r || jsonb_build_object('nome', coalesce(nullif(nm,''), g360_email())); end if;
  return r || jsonb_build_object('ok', (r ->> 'perfil') is not null, 'perfis', g360_const() -> 'perfis', 'separadores', g360_const() -> 'separadores');
end $$;
revoke all on function public.g360_eu() from public, anon;
grant execute on function public.g360_eu() to authenticated;

-- as regras de acesso passam a usar o perfil calculado
create or replace function public.g360_direcao() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((g360_perfil_de(g360_email()) ->> 'admin')::boolean, false)
      or (g360_perfil_de(g360_email()) ->> 'perfil') in ('dexec','dped') $$;
create or replace function public.g360_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((g360_perfil_de(g360_email()) ->> 'admin')::boolean, false) $$;
create or replace function public.g360_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select (g360_perfil_de(g360_email()) ->> 'perfil') is not null $$;

-- gestão dos perfis (só administradores)
create or replace function public.g360_perfis_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := g360_const();
begin
  if not g360_admin() then raise exception 'Só os administradores da EPISJ 360 gerem os perfis.' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true,
    'loja', coalesce((select valor from g360_config where chave = 'perfis'), '{"v":1,"admins":[],"utilizadores":{},"formandos":{"dominios":[],"padrao":""},"vis":{},"modsOff":[]}'::jsonb),
    'perfis', c -> 'perfis', 'separadores', c -> 'separadores', 'visOmissao', c -> 'visOmissao',
    'adminsServico', coalesce((select jsonb_agg(email) from g360_membros where admin), '[]'::jsonb), 'adminAuto', '',
    'professores', coalesce((select jsonb_agg(jsonb_build_object('nome', x ->> 'nome', 'email', lower(x ->> 'email')))
                             from jsonb_array_elements(coalesce((select valor from g360_config where chave = 'profs'), '[]'::jsonb)) x
                             where coalesce(x ->> 'email','') <> ''), '[]'::jsonb));
end $$;
revoke all on function public.g360_perfis_ler() from public, anon;
grant execute on function public.g360_perfis_ler() to authenticated;

create or replace function public.g360_perfis_gravar(p_loja jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := g360_email(); l jsonb := coalesce(p_loja, '{}'::jsonb);
begin
  if not g360_admin() then raise exception 'Só os administradores da EPISJ 360 gerem os perfis.' using errcode = '42501'; end if;
  -- quem grava não se tira a si próprio de administrador (ficava sem forma de voltar)
  if not (coalesce(l -> 'admins', '[]'::jsonb) ? e) and not exists (select 1 from g360_membros where email = e and admin) then
    l := jsonb_set(l, '{admins}', coalesce(l -> 'admins', '[]'::jsonb) || to_jsonb(e));
  end if;
  l := l || jsonb_build_object('t', (extract(epoch from now()) * 1000)::bigint, 'por', e);
  insert into g360_config (chave, valor, t, por) values ('perfis', l, (l ->> 't')::bigint, e)
    on conflict (chave) do update set valor = excluded.valor, t = excluded.t, por = excluded.por;
  return jsonb_build_object('ok', true, 'loja', l);
end $$;
revoke all on function public.g360_perfis_gravar(jsonb) from public, anon;
grant execute on function public.g360_perfis_gravar(jsonb) to authenticated;

-- dados publicados pela Direção (turmas, formadores, horários) — leitura filtrada por perfil
create or replace function public.g360_publico_ler() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p jsonb := g360_perfil_de(g360_email()); d jsonb;
begin
  if (p ->> 'perfil') is null then raise exception 'Sem perfil na EPISJ 360.' using errcode = '42501'; end if;
  d := coalesce((select valor from g360_config where chave = 'publico'), '{}'::jsonb);
  if (p ->> 'perfil') = 'form' and not coalesce((p ->> 'admin')::boolean, false) and jsonb_typeof(d -> 'profs') = 'array' then
    d := jsonb_set(d, '{profs}', (select coalesce(jsonb_agg(x - 'email'), '[]'::jsonb) from jsonb_array_elements(d -> 'profs') x));
  end if;
  return d;
end $$;
revoke all on function public.g360_publico_ler() from public, anon;
grant execute on function public.g360_publico_ler() to authenticated;

create or replace function public.g360_publico_gravar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := g360_email(); t bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not g360_direcao() then raise exception 'Só a Direção publica os dados da escola.' using errcode = '42501'; end if;
  insert into g360_config (chave, valor, t, por) values ('publico', coalesce(p, '{}'::jsonb), t, e)
    on conflict (chave) do update set valor = excluded.valor, t = excluded.t, por = excluded.por;
  insert into g360_config (chave, valor, t, por)
    values ('profs', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'nome', x ->> 'nome', 'email', lower(x ->> 'email')))
                               from jsonb_array_elements(case when jsonb_typeof(p -> 'profs') = 'array' then p -> 'profs' else '[]'::jsonb end) x
                               where coalesce(x ->> 'email','') <> ''), '[]'::jsonb), t, e)
    on conflict (chave) do update set valor = excluded.valor, t = excluded.t, por = excluded.por;
  return jsonb_build_object('ok', true, 't', t);
end $$;
revoke all on function public.g360_publico_gravar(jsonb) from public, anon;
grant execute on function public.g360_publico_gravar(jsonb) to authenticated;

-- só contam sessões que entraram pelo Office 365 da escola (fornecedor azure); qualquer outro tipo de conta fica sem perfil
create or replace function public.g360_email() returns text
language sql stable set search_path = public as $$
  select case when coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'azure'
                or coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'azure'
              then lower(coalesce(auth.jwt() ->> 'email', '')) else '' end $$;
revoke all on function public.g360_email() from public, anon;
grant execute on function public.g360_email() to authenticated;


-- ============================================================
-- 0.9.47–0.9.50 (já aplicado no projeto episj360)
-- ============================================================

-- Formandos: recebem só o necessário — sem emails dos formadores, sem lista de formandos,
-- sem planos curriculares e sem a lista de alunos dentro dos horários
create or replace function public.g360_publico_ler()
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare p jsonb := g360_perfil_de(g360_email()); d jsonb; k text; v jsonb; st jsonb;
begin
  if (p ->> 'perfil') is null then raise exception 'Sem perfil na EPISJ 360.' using errcode = '42501'; end if;
  d := coalesce((select valor from g360_config where chave = 'publico'), '{}'::jsonb);
  if (p ->> 'perfil') = 'form' and not coalesce((p ->> 'admin')::boolean, false) then
    if jsonb_typeof(d -> 'profs') = 'array' then
      d := jsonb_set(d, '{profs}', (select coalesce(jsonb_agg(x - 'email'), '[]'::jsonb) from jsonb_array_elements(d -> 'profs') x));
    end if;
    if jsonb_typeof(d -> 'escola') = 'object' then
      d := jsonb_set(d, '{escola}', (d -> 'escola') - 'formandos' - 'planos');
    end if;
    if jsonb_typeof(d #> '{es,porAno}') = 'object' then
      for k, v in select * from jsonb_each(d #> '{es,porAno}') loop
        begin
          st := (v ->> 'estado')::jsonb;
          if st is not null then
            d := jsonb_set(d, array['es','porAno',k,'estado'], to_jsonb((st - 'alunos')::text));
          end if;
        exception when others then null;
        end;
      end loop;
    end if;
  end if;
  return d;
end $function$;

-- Tempo real: os computadores e iPads da Direção recebem logo as alterações uns dos outros
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'g360_estado') then
    alter publication supabase_realtime add table public.g360_estado;
  end if;
end $$;

-- O histórico não incha (nada é apagado — só se deixam de guardar cópias repetidas)
create or replace function public.g360_guardar_historico()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' and old.dados is distinct from new.dados then
    if length(coalesce(new.dados, '')) < length(coalesce(old.dados, '')) * 0.8
       or split_part(coalesce(old.por, ''), '#', 1) is distinct from split_part(coalesce(new.por, ''), '#', 1)
       or not exists (select 1 from public.g360_historico h where h.nome = old.nome and h.guardado > now() - interval '15 minutes')
    then
      insert into public.g360_historico (nome, dados, t, por) values (old.nome, old.dados, old.t, old.por);
    end if;
  end if;
  new.atualizado := now();
  return new;
end $function$;

create or replace function public.g360_config_hist()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' and old.valor is distinct from new.valor and old.chave not in ('publico', 'profs') then
    insert into public.g360_config_historico (chave, valor, t, por) values (old.chave, old.valor, old.t, old.por);
  end if;
  new.atualizado := now(); return new;
end $function$;

create or replace function public.g360_publico_gravar(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare e text := g360_email(); t bigint := (extract(epoch from now()) * 1000)::bigint; atual jsonb;
begin
  if not g360_direcao() then raise exception 'Só a Direção publica os dados da escola.' using errcode = '42501'; end if;
  select valor into atual from g360_config where chave = 'publico';
  if atual is not null and (atual - 't' - 'por') = (coalesce(p, '{}'::jsonb) - 't' - 'por') then
    return jsonb_build_object('ok', true, 't', (select c.t from g360_config c where c.chave = 'publico'), 'igual', true);
  end if;
  insert into g360_config (chave, valor, t, por) values ('publico', coalesce(p, '{}'::jsonb), t, e)
    on conflict (chave) do update set valor = excluded.valor, t = excluded.t, por = excluded.por;
  insert into g360_config (chave, valor, t, por)
    values ('profs', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'nome', x ->> 'nome', 'email', lower(x ->> 'email')))
                               from jsonb_array_elements(case when jsonb_typeof(p -> 'profs') = 'array' then p -> 'profs' else '[]'::jsonb end) x
                               where coalesce(x ->> 'email','') <> ''), '[]'::jsonb), t, e)
    on conflict (chave) do update set valor = excluded.valor, t = excluded.t, por = excluded.por;
  return jsonb_build_object('ok', true, 't', t);
end $function$;
revoke all on function public.g360_publico_gravar(jsonb) from public, anon;
grant execute on function public.g360_publico_gravar(jsonb) to authenticated;

-- 0.9.55: os formadores e formandos guardam no aparelho o que a Direção publicou e só voltam a descarregar quando há outra publicação
create or replace function public.g360_publico_versao() returns bigint
language sql stable security definer set search_path to 'public' as $$
  select case when (public.g360_perfil_de(public.g360_email()) ->> 'perfil') is null then null
              else (select c.t from public.g360_config c where c.chave = 'publico') end
$$;
revoke all on function public.g360_publico_versao() from public, anon;
grant execute on function public.g360_publico_versao() to authenticated;
