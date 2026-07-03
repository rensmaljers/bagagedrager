-- 068: push-notificatie bij nieuwe uitslag/stand
-- Nieuwe cron-functie auto-notify-results stuurt een push naar alle deelnemers
-- van een competitie zodra een etappe-uitslag binnen is (stage_results aanwezig
-- + etappe gelockt). Vlag voorkomt dubbele meldingen, zelfde mechaniek als
-- reminder_sent / rad_assigned.

alter table stages add column if not exists results_notified boolean not null default false;

-- Backfill: geen meldingen-lawine over uitslagen die er al staan
update stages set results_notified = true
where exists (select 1 from stage_results sr where sr.stage_id = stages.id);

-- Cron: elke 10 minuten (uitslag komt via auto-sync of admin binnen)
select cron.unschedule('auto-notify-results') where exists (
  select 1 from cron.job where jobname = 'auto-notify-results'
);
select cron.schedule(
  'auto-notify-results',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-notify-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);
