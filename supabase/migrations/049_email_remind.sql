-- Email herinnering 4 uur voor deadline als er geen keuze is gemaakt

ALTER TABLE stages ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false;

-- Verwijder eventueel bestaande job (idempotent)
SELECT cron.unschedule('email-remind') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-remind');

-- Elk uur: check etappes met deadline over 3.5–4.5 uur
SELECT cron.schedule(
  'email-remind',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/email-remind',
    headers := jsonb_build_object('x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')),
    body    := '{}'::jsonb
  )
  $$
);
