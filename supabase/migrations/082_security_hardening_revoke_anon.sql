-- 082: security-hardening vervolg — REVOKE van anon/authenticated (081 was incompleet)
--
-- Migratie 081 deed `REVOKE EXECUTE ... FROM PUBLIC`, maar Supabase geeft de
-- rollen `anon` en `authenticated` een EIGEN expliciete EXECUTE-grant op functies
-- in schema public (niet via PUBLIC). Live geverifieerd na 081: get_cron_secret
-- gaf als anon nog steeds HTTP 200 + het secret. Daarom hier expliciet revoken
-- van anon en authenticated. service_role behield zijn grant uit 081 en blijft
-- werken (cron/edge functions); de owner (postgres) houdt sowieso execute.

REVOKE EXECUTE ON FUNCTION assign_random_riders(int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_cron_secret()          FROM anon, authenticated;

-- Secret opnieuw roteren: het was leesbaar tot deze migratie (en de vorige
-- rotatiewaarde is tijdens de verificatie opgehaald). Jobs + get_cron_secret
-- lezen dynamisch uit _app_config, dus de rotatie werkt zichzelf door.
UPDATE _app_config
SET value = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE key = 'cron_secret';
