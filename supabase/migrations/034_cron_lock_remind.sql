-- ============================================
-- FIX 034: Cron jobs voor stage lock en herinneringen
-- ============================================

-- Verwijder bestaande jobs (idempotent)
SELECT cron.unschedule('auto-lock-stages') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-lock-stages');
SELECT cron.unschedule('auto-remind') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-remind');

-- Elke 10 minuten: vergrendel etappes waarvan de deadline voorbij is
SELECT cron.schedule(
  'auto-lock-stages',
  '*/10 * * * *',
  $$ UPDATE stages SET locked = true WHERE deadline < now() AND locked = false $$
);

-- Elke 30 minuten: stuur herinneringen voor etappes die over 30–90 minuten starten
SELECT cron.schedule(
  'auto-remind',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-remind',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
