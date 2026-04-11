-- ============================================
-- FIX 032: Cron schedules voor auto-rad en auto-sync
-- Gebruikt pg_cron + pg_net om Edge Functions aan te roepen.
-- verify_jwt = false, dus geen Authorization header nodig.
-- ============================================

-- Verwijder bestaande jobs zodat dit idempotent is
SELECT cron.unschedule('auto-rad') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-rad'
);
SELECT cron.unschedule('auto-sync') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-sync'
);

-- Elke 10 minuten: Rad van Fortuin voor etappes waarvan deadline net verstreken is
SELECT cron.schedule(
  'auto-rad',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-rad',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- Dagelijks om 09:00 en 16:00 UTC (= 11:00 en 18:00 Nederlandse zomertijd)
SELECT cron.schedule(
  'auto-sync-ochtend',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'auto-sync-middag',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
