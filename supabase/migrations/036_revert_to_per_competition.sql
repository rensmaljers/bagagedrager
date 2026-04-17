-- ============================================
-- FIX 036: Zet functies terug naar per-competitie controle (revert 035)
-- Herstelt submit_pick, admin_upsert_pick en assign_random_riders
-- naar de correcte per-competitie controle.
-- ============================================

-- submit_pick: check binnen dezelfde competitie
CREATE OR REPLACE FUNCTION submit_pick(p_stage_id int, p_rider_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_stage record;
  v_comp_id int;
  v_is_late boolean;
  v_already_used boolean;
  v_existing_pick record;
  v_result record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  SELECT * INTO v_stage FROM stages WHERE id = p_stage_id;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Etappe niet gevonden';
  END IF;

  v_comp_id := v_stage.competition_id;
  v_is_late := (now() > v_stage.deadline) OR v_stage.locked;

  -- Check of renner al gebruikt in andere etappe van dezelfde competitie
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

-- admin_upsert_pick: check binnen dezelfde competitie
CREATE OR REPLACE FUNCTION admin_upsert_pick(
  p_user_id uuid,
  p_stage_id int,
  p_rider_id int,
  p_is_late boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_competition_id int;
  v_used_elsewhere int;
BEGIN
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  SELECT s.competition_id INTO v_competition_id FROM stages s WHERE s.id = p_stage_id;
  IF v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Etappe bestaat niet';
  END IF;

  SELECT COUNT(*) INTO v_used_elsewhere
  FROM picks p
  JOIN stages s ON s.id = p.stage_id
  WHERE p.user_id = p_user_id
    AND s.competition_id = v_competition_id
    AND p.rider_id = p_rider_id
    AND p.stage_id <> p_stage_id;

  IF v_used_elsewhere > 0 THEN
    RAISE EXCEPTION 'Deze renner is al gebruikt door deze speler in een andere etappe';
  END IF;

  INSERT INTO picks (user_id, stage_id, rider_id, is_late, is_random)
  VALUES (p_user_id, p_stage_id, p_rider_id, coalesce(p_is_late, false), false)
  ON CONFLICT (user_id, stage_id)
  DO UPDATE SET
    rider_id = excluded.rider_id,
    is_late  = excluded.is_late,
    is_random = false;

  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_upsert_pick(uuid, int, int, boolean) TO authenticated;

-- assign_random_riders: check binnen dezelfde competitie (ongewijzigd)
CREATE OR REPLACE FUNCTION assign_random_riders(p_stage_id int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_comp_id int;
  v_user record;
  v_rider_id int;
  v_count int := 0;
BEGIN
  SELECT competition_id INTO v_comp_id FROM stages WHERE id = p_stage_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Stage niet gevonden');
  END IF;

  FOR v_user IN
    SELECT DISTINCT p.user_id
    FROM picks p
    JOIN stages s ON s.id = p.stage_id
    WHERE s.competition_id = v_comp_id
      AND p.user_id NOT IN (
        SELECT user_id FROM picks WHERE stage_id = p_stage_id
      )
  LOOP
    SELECT r.id INTO v_rider_id
    FROM riders r
    WHERE r.competition_id = v_comp_id
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
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_count);
END;
$$;
