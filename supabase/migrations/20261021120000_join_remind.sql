-- ============================================
-- Inschrijf-pushes: "Inschrijving geopend" + "Laatste kans"
-- ============================================
-- Aanleiding: bij de Tour of Guangxi 2026 schreef maar 1 speler zich in — het
-- "Ik doe mee" was nieuw en niemand werd erop gewezen. Edge function
-- auto-join-remind (elk uur) stuurt per actieve, nog niet gestarte ronde:
--   - eenmalig "Inschrijving geopend" (zodra de ronde actief is en etappes heeft)
--   - eenmalig "Laatste kans" binnen 24 uur vóór de start
-- aan actieve, niet-AI spelers die nog niet ingeschreven zijn. Vlaggen hieronder
-- voorkomen dubbele meldingen (gezet vóór de verzendloop, conventie notificaties).

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS join_open_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS join_reminder_sent_at timestamptz;

-- Rondes die al gestart of afgelopen zijn hoeven nooit meer een inschrijf-push
UPDATE competitions c
SET join_open_notified_at = COALESCE(c.join_open_notified_at, now()),
    join_reminder_sent_at = COALESCE(c.join_reminder_sent_at, now())
WHERE EXISTS (
  SELECT 1 FROM stages s
  WHERE s.competition_id = c.id AND (s.locked OR s.deadline <= now())
);

-- Elk uur op :20 (tussen de bestaande jobs; niet strakker dan nodig — Disk IO, 079)
SELECT cron.unschedule('auto-join-remind') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-join-remind'
);
SELECT cron.schedule('auto-join-remind', '20 * * * *', $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-join-remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
$$);
