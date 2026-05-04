-- ============================================
-- 042: Cron secret automatisch genereren + job fixen
--
-- 041 was al applied met placeholder-instellingen.
-- Dit corrigeert: secret genereren in DB en cron-job
-- herschrijven met vaste URL (geen handmatige stappen).
-- ============================================

-- Sla cron secret op in een tabel (ALTER DATABASE SET vereist superuser)
create table if not exists _app_config (
  key   text primary key,
  value text not null
);

-- Alleen postgres/service role mag lezen
revoke all on _app_config from anon, authenticated;

-- Genereer eenmalig een veilig cron secret
insert into _app_config (key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Helper zodat edge function het secret kan ophalen via RPC
create or replace function get_cron_secret()
  returns text language sql security definer
  as $$ select value from _app_config where key = 'cron_secret'; $$;

-- Vervang kapotte cron-job (gebruikte unset current_setting) door versie met vaste URL
select cron.unschedule('weekly-rider-specialty-refresh') where exists (
  select 1 from cron.job where jobname = 'weekly-rider-specialty-refresh'
);

select cron.schedule(
  'weekly-rider-specialty-refresh',
  '0 3 * * 1',
  $$
  select net.http_post(
    url     := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/cron-refresh-specialties',
    headers := jsonb_build_object('x-cron-secret', (select value from _app_config where key = 'cron_secret')),
    body    := '{}'::jsonb
  );
  $$
);
