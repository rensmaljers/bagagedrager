-- 081: security-hardening — publieke aanroep van interne RPC's dichten
--
-- Aanleiding: code-audit 19-07-2026. Twee SECURITY DEFINER-functies stonden op
-- de Postgres-default (EXECUTE aan PUBLIC), dus anon/authenticated konden ze via
-- PostgREST rechtstreeks aanroepen:
--   * assign_random_riders(int) — kon het Rad vóór de deadline forceren op elke
--     etappe; is_random-picks tellen mee in de klassementen (mig 077).
--   * get_cron_secret()          — gaf het cron-secret terug aan iedereen; dat
--     secret is de enige auth-grens van alle cron-edge-functions (mig 042).
--
-- Beide horen alléén door de service-role (cron/edge functions) aangeroepen te
-- worden. We REVOKE'en van PUBLIC en GRANT'en expliciet aan service_role, zodat
-- auto-rad (rpc assign_random_riders) en de cron-auth (rpc get_cron_secret in
-- alle cron-functies) blijven werken. De owner (postgres) houdt sowieso execute,
-- dus de interne aanroep vanuit admin_save_results blijft ook werken.

REVOKE EXECUTE ON FUNCTION assign_random_riders(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION assign_random_riders(int) TO service_role;

REVOKE EXECUTE ON FUNCTION get_cron_secret() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_cron_secret() TO service_role;

-- Cron-secret roteren (kan al gelekt zijn zolang get_cron_secret publiek was).
-- De cron-jobs sturen het secret mee via (SELECT value FROM _app_config ...)
-- (mig 079) en get_cron_secret leest uit dezelfde rij, dus de rotatie werkt
-- zichzelf consistent door. Enige effect: een cron-run die exact op het
-- rotatiemoment in-flight is kan één 401 krijgen; de volgende run herstelt.
UPDATE _app_config
SET value = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE key = 'cron_secret';
