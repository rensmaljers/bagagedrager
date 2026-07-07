-- Disk IO budget: spread out the busiest cron jobs (*/10 -> */15) to reduce
-- steady-state invocation volume. cron.schedule() with an existing jobname
-- updates the schedule in place (no need to unschedule/reschedule).

select cron.schedule('auto-lock-stages', '*/15 * * * *', $$
  UPDATE stages SET locked = true WHERE deadline < now() AND locked = false
$$);

select cron.schedule('auto-rad', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-rad',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
$$);

select cron.schedule('auto-notify-results', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-notify-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
$$);
