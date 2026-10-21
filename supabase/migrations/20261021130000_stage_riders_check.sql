-- ============================================
-- Klassiekers: startlijst per koers (stage_riders) leidend
-- ============================================
-- Migratie 038 liet submit_pick en het Rad alleen renners van de etappe-eigen
-- startlijst toe (klassiekers: niet elke renner start in elke koers). Vanaf 051
-- werden beide functies opnieuw gedefinieerd zónder die check — sindsdien kon het
-- Rad bij klassiekers een renner toewijzen die die dag niet start (straftijd).
-- De keuzelijst in de app filterde wel (Pick.svelte), de server niet.
--
-- Hersteld in de leidende definities (was 20261006120000_deelname_inschrijving):
--   * submit_pick           — weigert renners buiten de etappe-startlijst
--   * assign_random_riders  — Rad kiest alleen uit de etappe-startlijst
--   * admin_add_participant — te-late Rad-picks per gestarte etappe idem
--     (behoudt zijn eigen, eenvoudigere DNF-regel: alleen riders.dnf)
-- Geen stage_riders-rijen voor een etappe = volledige competitie-startlijst
-- (grote rondes ongewijzigd).
--
-- Tweede wijziging (besluit okt 2026): heeft een etappe een eigen startlijst, dan
-- is die óók leidend boven de DNF-blokkade uit 052/053. Bij klassiekers staat elke
-- koers op zich: wie in Milaan-Sanremo uitvalt start een week later gewoon in de
-- Ronde van Vlaanderen, maar werd tot nu toe voor de hele competitie geblokkeerd.
-- Zonder eigen startlijst (grote rondes) blijft "eenmaal DNF = niet meer kiesbaar".
-- "Elke renner één keer per competitie" geldt overal ongewijzigd.

CREATE OR REPLACE FUNCTION submit_pick(p_stage_id int, p_rider_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_stage record;
  v_comp_id int;
  v_is_late boolean;
  v_already_used boolean;
  v_is_dnf boolean;
  v_existing_pick record;
  v_result record;
BEGIN
  PERFORM set_config('audit.source', 'submit_pick', true);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  SELECT * INTO v_stage FROM stages WHERE id = p_stage_id;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Etappe niet gevonden';
  END IF;

  v_comp_id := v_stage.competition_id;

  IF NOT EXISTS (SELECT 1 FROM competition_participants
                 WHERE competition_id = v_comp_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Je doet niet mee aan deze ronde — schrijf je in vóór de start';
  END IF;

  IF EXISTS (SELECT 1 FROM competition_participants
             WHERE competition_id = v_comp_id AND user_id = v_user_id AND dns_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Je bent uit de koers (DNS): drie etappes op rij geen keuze';
  END IF;

  -- Klassiekers: heeft deze etappe een eigen startlijst (stage_riders), dan moet de
  -- renner daarop staan (038; weggevallen in 051, hersteld in deze migratie)
  IF EXISTS (SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id)
     AND NOT EXISTS (SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id AND rider_id = p_rider_id) THEN
    RAISE EXCEPTION 'Deze renner start niet in deze etappe';
  END IF;

  v_is_late := (now() > v_stage.deadline) OR v_stage.locked;

  SELECT EXISTS(
    SELECT 1 FROM picks p
    JOIN stages s ON s.id = p.stage_id
    WHERE p.user_id = v_user_id
      AND p.rider_id = p_rider_id
      AND p.stage_id != p_stage_id
      AND s.competition_id = v_comp_id
  ) INTO v_already_used;

  IF v_already_used THEN
    RAISE EXCEPTION 'Je hebt deze renner al gebruikt in een andere etappe';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM riders WHERE id = p_rider_id AND dnf = true
    UNION ALL
    SELECT 1 FROM stage_results sr
    JOIN stages s ON s.id = sr.stage_id
    WHERE sr.rider_id = p_rider_id
      AND sr.dnf = true
      AND s.competition_id = v_comp_id
  ) INTO v_is_dnf;

  -- DNF-blokkade alleen zonder eigen etappe-startlijst (grote rondes); bij een
  -- startlijst (klassiekers) is die leidend en is de check hierboven al gedaan
  IF v_is_dnf AND NOT EXISTS (SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id) THEN
    RAISE EXCEPTION 'Deze renner heeft de koers verlaten (DNF) en kan niet meer gekozen worden';
  END IF;

  SELECT * INTO v_existing_pick FROM picks
  WHERE user_id = v_user_id AND stage_id = p_stage_id;

  IF v_existing_pick IS NOT NULL AND v_is_late THEN
    RAISE EXCEPTION 'Etappe is vergrendeld, keuze kan niet meer gewijzigd worden';
  END IF;

  INSERT INTO picks (user_id, stage_id, rider_id, is_late, submitted_at)
  VALUES (v_user_id, p_stage_id, p_rider_id, v_is_late, now())
  ON CONFLICT (user_id, stage_id)
  DO UPDATE SET rider_id = p_rider_id, is_late = v_is_late, submitted_at = now()
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'success', true,
    'pick_id', v_result.id,
    'is_late', v_is_late,
    'warning', CASE WHEN v_is_late THEN 'Keuze ingediend na deadline — te laat straf geldt' ELSE null END
  );
END;
$$;

CREATE OR REPLACE FUNCTION assign_random_riders(p_stage_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id int;
  v_user record;
  v_rider_id int;
  v_count int := 0;
  v_dns int := 0;
BEGIN
  PERFORM set_config('audit.source', 'assign_random_riders', true);

  SELECT competition_id INTO v_comp_id FROM stages WHERE id = p_stage_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Stage niet gevonden');
  END IF;

  FOR v_user IN
    SELECT cp.user_id
    FROM competition_participants cp
    WHERE cp.competition_id = v_comp_id
      AND cp.dns_at IS NULL
      AND cp.user_id NOT IN (
        SELECT user_id FROM picks WHERE stage_id = p_stage_id
      )
  LOOP
    SELECT r.id INTO v_rider_id
    FROM riders r
    WHERE r.competition_id = v_comp_id
      AND (
        -- Eigen etappe-startlijst (klassiekers): die is leidend, ook na eerdere DNF
        r.id IN (SELECT rider_id FROM stage_riders WHERE stage_id = p_stage_id)
        OR (
          -- Geen startlijst (grote rondes): volledige lijst minus uitvallers
          NOT EXISTS (SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id)
          AND r.dnf = false
          AND NOT EXISTS (
            SELECT 1 FROM stage_results sr
            JOIN stages s ON s.id = sr.stage_id
            WHERE sr.rider_id = r.id
              AND sr.dnf = true
              AND s.competition_id = v_comp_id
          )
        )
      )
      AND r.id NOT IN (
        SELECT pk.rider_id FROM picks pk
        JOIN stages st ON st.id = pk.stage_id
        WHERE pk.user_id = v_user.user_id
          AND st.competition_id = v_comp_id
      )
    ORDER BY random()
    LIMIT 1;

    IF v_rider_id IS NOT NULL THEN
      INSERT INTO picks (user_id, stage_id, rider_id, is_late, is_random)
      VALUES (v_user.user_id, p_stage_id, v_rider_id, false, true);
      v_count := v_count + 1;
      IF check_dns(p_stage_id, v_user.user_id) THEN
        v_dns := v_dns + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_count, 'dns', v_dns);
END;
$$;

CREATE OR REPLACE FUNCTION admin_add_participant(p_competition_id int, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_stage record;
  v_rider_id int;
  v_count int := 0;
BEGIN
  PERFORM set_config('audit.source', 'admin_add_participant', true);

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = auth.uid();
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  INSERT INTO competition_participants (competition_id, user_id)
  VALUES (p_competition_id, p_user_id)
  ON CONFLICT (competition_id, user_id) DO NOTHING;

  FOR v_stage IN
    SELECT id FROM stages
    WHERE competition_id = p_competition_id
      AND (locked OR deadline <= now())
      AND NOT EXISTS (SELECT 1 FROM picks WHERE stage_id = stages.id AND user_id = p_user_id)
    ORDER BY stage_number
  LOOP
    SELECT r.id INTO v_rider_id
    FROM riders r
    WHERE r.competition_id = p_competition_id
      AND (
        r.id IN (SELECT rider_id FROM stage_riders WHERE stage_id = v_stage.id)
        OR (NOT EXISTS (SELECT 1 FROM stage_riders WHERE stage_id = v_stage.id) AND r.dnf = false)
      )
      AND r.id NOT IN (
        SELECT pk.rider_id FROM picks pk
        JOIN stages st ON st.id = pk.stage_id
        WHERE pk.user_id = p_user_id AND st.competition_id = p_competition_id
      )
    ORDER BY random()
    LIMIT 1;

    IF v_rider_id IS NOT NULL THEN
      INSERT INTO picks (user_id, stage_id, rider_id, is_late, is_random)
      VALUES (p_user_id, v_stage.id, v_rider_id, true, true);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'late_picks', v_count);
END;
$$;

-- EXECUTE-hygiëne: CREATE OR REPLACE behoudt grants, maar expliciet zoals 081/086
REVOKE EXECUTE ON FUNCTION assign_random_riders(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assign_random_riders(int) TO service_role;
REVOKE EXECUTE ON FUNCTION submit_pick(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION submit_pick(integer, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION admin_add_participant(integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_add_participant(integer, uuid) TO authenticated, service_role;
