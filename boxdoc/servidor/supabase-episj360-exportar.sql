-- EPISJ 360 — exportação completa diária (função g360-exportar)
-- Bucket privado onde ficam as exportações; só a Direção lê (a função grava com a chave de serviço).
insert into storage.buckets (id, name, public, file_size_limit)
values ('g360-copias', 'g360-copias', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "g360_copias_direcao_le" on storage.objects;
create policy "g360_copias_direcao_le" on storage.objects
  for select to authenticated
  using (bucket_id = 'g360-copias' and public.g360_direcao());

-- todos os dias às 04:17 (UTC ≈ 03:17 nos Açores no inverno), mesmo com os computadores desligados
select cron.unschedule('episj360-exportar') where exists (select 1 from cron.job where jobname = 'episj360-exportar');
select cron.schedule('episj360-exportar', '17 4 * * *', $$
  select net.http_post(
    url := 'https://oovqekytlhkbinfdxjwf.supabase.co/functions/v1/g360-exportar',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 150000);
$$);
