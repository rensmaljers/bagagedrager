-- ============================================
-- 072: ETA-gestuurde sync + niet-starters-check
-- 1. auto-sync-eta: elke 15 min met {"mode":"eta"} — auto-sync synct dan
--    alleen etappes waarvan de verwachte aankomst (estimated_end_time) + 20
--    min verstreken is en die nog geen resultaten hebben. De vaste runs om
--    9:00/16:00 UTC blijven bestaan als correctie-pass/vangnet.
-- 2. auto-dns-check: elke 30 min — parset PCS' dropouts-pagina voor etappes
--    met een deadline binnen 3 uur, zet riders.dnf voor nieuwe uitvallers en
--    pusht spelers die een niet-starter gepickt hebben.
-- ============================================

SELECT cron.unschedule('auto-sync-eta') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-sync-eta');
SELECT cron.schedule('auto-sync-eta', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{"mode":"eta"}'::jsonb
  )
$$);

SELECT cron.unschedule('auto-dns-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-dns-check');
SELECT cron.schedule('auto-dns-check', '*/30 * * * *', $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-dns-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
$$);
