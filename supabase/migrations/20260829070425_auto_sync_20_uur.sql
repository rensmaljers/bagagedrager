-- Extra dagelijkse correctie-pass om 20:00 Nederlandse tijd.
-- pg_cron plant in UTC. Door zowel 18:00 als 19:00 UTC te evalueren en de
-- lokale tijd te controleren, blijft dit 20:00 bij zomer- en wintertijd.
SELECT cron.unschedule('auto-sync-avond') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-sync-avond'
);

SELECT cron.schedule(
  'auto-sync-avond',
  '0 18,19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  WHERE EXTRACT(HOUR FROM now() AT TIME ZONE 'Europe/Amsterdam') = 20
  $$
);
