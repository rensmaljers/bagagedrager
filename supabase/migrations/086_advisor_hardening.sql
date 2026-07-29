-- ============================================
-- 086: Advisor-hardening (Supabase linter WARNs, juli 2026)
-- ============================================
-- 1) search_path vastzetten op zes oude functies. Conventie sinds migratie
--    060; deze zes stammen uit 008/009/011/054/057 en misten hem.
-- 2) Publieke listing van de avatars-bucket dicht: de brede SELECT-policy
--    uit 012 liet iedereen alle bestandspaden opsommen. Weergave gebruikt de
--    publieke object-URL (bucket is public, geen policy nodig); eigen-map-
--    toegang voor upload/upsert blijft via "Users manage own avatar" (FOR ALL,
--    dekt ook SELECT op de eigen map).
-- 3) EXECUTE-hygiëne op SECURITY DEFINER-RPC's:
--    a) user/admin-RPC's: anon eraf. De echte gate blijft de in-functie check
--       (auth.uid() / is_admin) — dit verkleint alleen het aanvalsvlak.
--       Les uit 082: anon/authenticated hebben op Supabase een éigen expliciete
--       EXECUTE-grant (niet via PUBLIC), dus we revoken PUBLIC én anon en geven
--       authenticated/service_role expliciet terug.
--    b) triggerfuncties + interne helper calculate_game_points: alle client-
--       rollen eraf. Trigger-firing checkt EXECUTE niet (alleen bij CREATE
--       TRIGGER); calculate_game_points wordt alleen via PERFORM vanuit
--       SECURITY DEFINER-functies aangeroepen (061/077) en die check draait
--       als owner.
--
-- Bewust NIET aangeraakt (advisor-findings dismissen als intentioneel):
--    - resolve_invite / redeem_invite: anon-EXECUTE is by design (invite-flow
--      vóór/zonder sessie, expliciete grants in 076).
--    - chosen_penalty_gap: wordt door de views general_classification en
--      stage_picks_public aangeroepen; EXECUTE op functies in een view wordt
--      als AANROEPER gecheckt — intrekken breekt de klassementen.
--    - sharing_multiplier c.s. blijven PUBLIC-executeerbaar om dezelfde reden.

-- 1) search_path
ALTER FUNCTION sharing_multiplier(integer) SET search_path = public;
ALTER FUNCTION position_to_game_points(integer) SET search_path = public;
ALTER FUNCTION bonification_seconds(integer) SET search_path = public;
ALTER FUNCTION sync_deadline_to_start_time() SET search_path = public;
ALTER FUNCTION check_max_users() SET search_path = public;
ALTER FUNCTION sync_global_photo_to_riders() SET search_path = public;

-- 2) avatars: geen publieke listing meer
DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;

-- 3a) user/admin-RPC's: PUBLIC + anon eraf, authenticated + service_role expliciet
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'submit_pick(integer, integer)',
    'withdraw_pick(integer)',
    'create_invite(integer, text)',
    'delete_own_account()',
    'submit_feedback(text, text)',
    'admin_confirm_email(uuid)',
    'admin_delete_pick(uuid, integer)',
    'admin_delete_player(uuid)',
    'admin_save_results(integer, jsonb, boolean)',
    'admin_upsert_pick(uuid, integer, integer, boolean)',
    'admin_users_with_status()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- 3b) triggerfuncties + interne helper: alle client-rollen eraf
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION guard_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION log_pick_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION calculate_game_points(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_game_points(integer) TO service_role;
