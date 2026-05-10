-- ============================================
-- 044: Bescherm handmatig bewerkte scores bij PCS-sync
--
-- Probleem: PCS-sync overschrijft handmatig ingevoerde waarden
-- (bijv. bonificatie of tijd die admin heeft gecorrigeerd).
--
-- Oplossing: manually_edited vlag op stage_results. PCS-sync
-- slaat rijen met deze vlag over; handmatige opslag zet de vlag.
-- ============================================

ALTER TABLE stage_results ADD COLUMN IF NOT EXISTS manually_edited boolean DEFAULT false;

CREATE OR REPLACE FUNCTION admin_save_results(
  p_stage_id int,
  p_results jsonb,
  p_manual boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_item jsonb;
  v_count int := 0;
  v_skipped int := 0;
  v_random_result jsonb;
BEGIN
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_user_id;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  SELECT assign_random_riders(p_stage_id) INTO v_random_result;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    -- PCS-sync slaat handmatig bewerkte rijen over
    IF NOT p_manual THEN
      IF EXISTS (
        SELECT 1 FROM stage_results
        WHERE stage_id = p_stage_id
          AND rider_id = (v_item->>'rider_id')::int
          AND manually_edited = true
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    INSERT INTO stage_results (stage_id, rider_id, time_seconds, finish_position, points, mountain_points, dnf, bonification_seconds, manually_edited)
    VALUES (
      p_stage_id,
      (v_item->>'rider_id')::int,
      (v_item->>'time_seconds')::int,
      (v_item->>'finish_position')::int,
      coalesce((v_item->>'points')::int, 0),
      coalesce((v_item->>'mountain_points')::int, 0),
      coalesce((v_item->>'dnf')::boolean, false),
      coalesce((v_item->>'bonification_seconds')::int, 0),
      p_manual
    )
    ON CONFLICT (stage_id, rider_id)
    DO UPDATE SET
      -- Bewaar dnf=true als die al handmatig gezet is
      dnf = CASE
        WHEN stage_results.dnf = true AND excluded.dnf = false THEN true
        ELSE excluded.dnf
      END,
      time_seconds = CASE
        WHEN stage_results.dnf = true AND excluded.dnf = false THEN 0
        ELSE excluded.time_seconds
      END,
      finish_position = CASE
        WHEN stage_results.dnf = true AND excluded.dnf = false THEN null
        ELSE excluded.finish_position
      END,
      points = excluded.points,
      mountain_points = excluded.mountain_points,
      bonification_seconds = excluded.bonification_seconds,
      -- manually_edited blijft true als die al gezet is
      manually_edited = p_manual OR stage_results.manually_edited;
    v_count := v_count + 1;
  END LOOP;

  UPDATE stages SET locked = true WHERE id = p_stage_id;
  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object(
    'success', true,
    'count', v_count,
    'skipped', v_skipped,
    'random', v_random_result
  );
END;
$$;
