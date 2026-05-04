-- ============================================
-- 041: Wekelijkse automatische specialty refresh
--
-- Ververs PCS specialty-scores voor alle renners
-- elke maandag om 03:00 UTC via pg_cron + pg_net.
-- Geen handmatige stappen vereist.
-- ============================================

-- HTTP-aanroepen vanuit SQL
create extension if not exists pg_net  with schema extensions;

-- Geplande taken vanuit SQL
create extension if not exists pg_cron with schema pg_catalog;

-- Bijhouden wanneer scores voor het laatst zijn ververst
alter table riders add column if not exists specialty_refreshed_at timestamptz;

-- Genereer eenmalig een veilig cron secret en sla op als DB-instelling
do $$
begin
  if coalesce(current_setting('app.cron_secret', true), '') = '' then
    execute format('alter database postgres set app.cron_secret = %L', encode(gen_random_bytes(32), 'hex'));
  end if;
end
$$;

-- Helper zodat edge function het secret kan ophalen via RPC
create or replace function get_cron_secret()
  returns text language sql security definer
  as $$ select current_setting('app.cron_secret', true); $$;

-- Verwijder eventuele eerdere versie van de taak
select cron.unschedule('weekly-rider-specialty-refresh') where exists (
  select 1 from cron.job where jobname = 'weekly-rider-specialty-refresh'
);

-- Elke maandag om 03:00 UTC
select cron.schedule(
  'weekly-rider-specialty-refresh',
  '0 3 * * 1',
  $$
  select net.http_post(
    url     := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/cron-refresh-specialties',
    headers := jsonb_build_object('x-cron-secret', current_setting('app.cron_secret')),
    body    := '{}'::jsonb
  );
  $$
);
