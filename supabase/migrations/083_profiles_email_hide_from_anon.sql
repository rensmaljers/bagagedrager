-- 083: profiles.email niet langer anoniem opvraagbaar
--
-- Aanleiding: code-audit 19-07-2026. De policy "Public read profiles" (USING true,
-- mig 001) + table-brede SELECT-grant maakten dat een anonieme bezoeker via
-- `GET /rest/v1/profiles?select=email` de e-mailadressen kon harvesten. Live
-- geverifieerd: 2 van de 27 profielen hebben een ingevuld adres, die waren dus
-- publiek leesbaar.
--
-- Postgres-valkuil: een kolom los REVOKE'en werkt niet zolang er een table-brede
-- SELECT-grant staat. Daarom de table-grant intrekken en expliciet alle kolommen
-- BEHALVE email teruggeven aan anon. `authenticated` blijft bewust ongemoeid
-- (die rol leunt op `select=*` in de boot-flow; volledig dichtzetten vergt een
-- frontend-refactor naar expliciete kolomlijsten + een admin-only e-mailview en
-- gebeurt apart, deploy-geordend en Playwright-geverifieerd).
--
-- De owner-draaiende views (general_classification, stage_picks_public) joinen
-- profiles maar draaien als owner, dus die raken hier niet door beperkt.

REVOKE SELECT ON profiles FROM anon;
GRANT SELECT (
  id, display_name, avatar_url, is_admin, is_active, is_ai,
  created_at, last_seen_at, email_reminders, favorite_team,
  cycling_hero, motto
) ON profiles TO anon;
