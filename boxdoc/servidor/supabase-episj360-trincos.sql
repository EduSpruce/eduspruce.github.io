-- EPISJ 360 0.9.113 — trinco entre computadores para as leituras automáticas da Box
-- Só um computador de cada vez faz a atualização automática das pastas («box-leitura») e a leitura de fundo do texto
-- dos documentos («box-texto»). O trinco caduca sozinho (p_seg segundos, entre 30 s e 1 h). Só a Direção o usa.
create table if not exists public.g360_trincos(
  nome text primary key,
  dono text not null,
  ate  timestamptz not null
);
alter table public.g360_trincos enable row level security; -- sem políticas: só a função mexe na tabela

create or replace function public.g360_trinco(p_nome text, p_dono text, p_seg integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v boolean;
begin
  if not public.g360_direcao() then return false; end if;
  insert into public.g360_trincos(nome, dono, ate)
  values (left(p_nome, 60), left(p_dono, 60), now() + make_interval(secs => least(greatest(coalesce(p_seg, 600), 30), 3600)))
  on conflict (nome) do update set dono = excluded.dono, ate = excluded.ate
    where public.g360_trincos.dono = excluded.dono or public.g360_trincos.ate < now()
  returning true into v;
  return coalesce(v, false);
end $$;
revoke all on function public.g360_trinco(text, text, integer) from public, anon;
grant execute on function public.g360_trinco(text, text, integer) to authenticated;
