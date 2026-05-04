-- ============================================
-- 041: Wekelijkse automatische specialty refresh
--
-- Ververs PCS specialty-scores voor alle renners
-- elke maandag om 03:00 UTC via pg_cron + pg_net.
--
-- VEREIST: stel eenmalig in via Supabase SQL-editor:
--   alter database postgres set app.supabase_url = 'https://YOUR_REF.supabase.co';
--   alter database postgres set app.cron_secret  = 'YOUR_CRON_SECRET';
--
-- En stel CRON_SECRET in als edge function secret:
--   supabase secrets set CRON_SECRET=YOUR_CRON_SECRET
-- ============================================

-- HTTP-aanroepen vanuit SQL
create extension if not exists pg_net  with schema extensions;

-- Geplande taken vanuit SQL
create extension if not exists pg_cron with schema pg_catalog;

-- Bijhouden wanneer scores voor het laatst zijn ververst
alter table riders add column if not exists specialty_refreshed_at timestamptz;

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
    url     := current_setting('app.supabase_url') || '/functions/v1/cron-refresh-specialties',
    headers := jsonb_build_object('x-cron-secret', current_setting('app.cron_secret')),
    body    := '{}'::jsonb
  );
  $$
);
