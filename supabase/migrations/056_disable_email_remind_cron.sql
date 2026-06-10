-- ============================================
-- FIX 056: email-remind cron uitschakelen
-- ============================================
-- Er is geen eigen domein, dus Resend kan niet namens de app verzenden;
-- de uurlijkse job liep elk uur stuk op een 403. Push-notificaties
-- (auto-remind) blijven de herinneringen verzorgen.
-- Her-aanzetten: zie migratie 034 voor het oorspronkelijke schedule.

SELECT cron.unschedule('email-remind') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'email-remind'
);
