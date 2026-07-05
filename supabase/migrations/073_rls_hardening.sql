-- ============================================
-- 073: RLS-hardening (vondsten security-audit 5 juli 2026)
--
-- 1. KRITIEK: "Users update own profile" (001) had geen kolomrestrictie —
--    een speler kon zijn eigen is_admin op true PATCHen en daarmee alle
--    admin-RPC's en admin-RLS ontgrendelen. Trigger blokkeert wijziging van
--    beschermde kolommen door niet-admins.
-- 2. KRITIEK: "Users insert own picks" (001) checkte alleen user_id — een
--    directe INSERT omzeilde alle submit_pick-regels (deadline, DNF,
--    renner-al-gebruikt). Alle schrijfpaden lopen via SECURITY DEFINER-RPC's
--    (submit_pick / withdraw_pick / assign_random_riders / admin_upsert_pick),
--    dus de policy kan volledig weg.
-- 3. handle_new_user (005) was de enige SECURITY DEFINER-functie die de
--    060-hardening miste: search_path vastzetten.
-- 4. Index voor de pcs_slug-lookups van de sync-functies.
-- ============================================

-- 1. Beschermde profiel-kolommen: alleen admins mogen ze wijzigen
CREATE OR REPLACE FUNCTION guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.is_ai IS DISTINCT FROM OLD.is_ai
      OR NEW.email IS DISTINCT FROM OLD.email)
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
     -- service role (edge functions/cron) heeft geen auth.uid() maar draait
     -- als table owner en passeert; ingelogde niet-admins worden geblokkeerd
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Alleen admins kunnen rollen wijzigen';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_privileges ON profiles;
CREATE TRIGGER trg_guard_profile_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileges();

-- 2. Directe picks-INSERT dicht: alles loopt via de RPC's
DROP POLICY IF EXISTS "Users insert own picks" ON picks;

-- 3. Ontbrekende search_path-hardening
ALTER FUNCTION handle_new_user() SET search_path = public;

-- 4. Sync-lookups: riders op (competition_id, pcs_slug)
CREATE INDEX IF NOT EXISTS idx_riders_comp_slug ON riders(competition_id, pcs_slug);
