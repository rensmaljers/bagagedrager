-- ============================================
-- FIX: finish_position uit PCS overnemen i.p.v. herberekenen
-- Bij gelijke time_seconds gaf ROW_NUMBER willekeurig posities,
-- waardoor de echte winnaar soms positie 2 of 3 kreeg.
-- ============================================

-- Update calculate_game_points: gebruik bestaande finish_position als die er is,
-- anders val terug op ROW_NUMBER (voor handmatig ingevoerde resultaten)
CREATE OR REPLACE FUNCTION calculate_game_points(p_stage_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Alleen game_points herberekenen op basis van bestaande finish_position
  -- finish_position wordt nu direct bij het opslaan gezet (vanuit PCS of handmatig)
  WITH ranked AS (
    SELECT id, dnf, finish_position,
      -- Fallback: als finish_position nog niet gezet is, bereken op basis van tijd
      COALESCE(finish_position,
        ROW_NUMBER() OVER (ORDER BY dnf ASC, time_seconds ASC)
      )::int AS pos
    FROM stage_results
    WHERE stage_id = p_stage_id
  )
  UPDATE stage_results sr
  SET finish_position = ranked.pos,
      game_points = CASE WHEN ranked.dnf THEN 0 ELSE position_to_game_points(ranked.pos) END
  FROM ranked
  WHERE sr.id = ranked.id;
END;
$$;

-- Update admin_save_results: finish_position uit payload opslaan
CREATE OR REPLACE FUNCTION admin_save_results(p_stage_id int, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_item jsonb;
  v_count int := 0;
  v_random_result jsonb;
BEGIN
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_user_id;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  -- Rad van Fortuin: wijs random renners toe voordat resultaten worden opgeslagen
  SELECT assign_random_riders(p_stage_id) INTO v_random_result;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    INSERT INTO stage_results (stage_id, rider_id, time_seconds, finish_position, points, mountain_points, dnf)
    VALUES (
      p_stage_id,
      (v_item->>'rider_id')::int,
      (v_item->>'time_seconds')::int,
      (v_item->>'finish_position')::int,  -- NULL als niet meegegeven → fallback in calculate_game_points
      coalesce((v_item->>'points')::int, 0),
      coalesce((v_item->>'mountain_points')::int, 0),
      coalesce((v_item->>'dnf')::boolean, false)
    )
    ON CONFLICT (stage_id, rider_id)
    DO UPDATE SET
      time_seconds = excluded.time_seconds,
      finish_position = excluded.finish_position,
      points = excluded.points,
      mountain_points = excluded.mountain_points,
      dnf = excluded.dnf;
    v_count := v_count + 1;
  END LOOP;

  -- Lock stage
  UPDATE stages SET locked = true WHERE id = p_stage_id;

  -- Bereken game_points (en vul finish_position aan als die NULL is)
  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object(
    'success', true,
    'count', v_count,
    'random_riders', v_random_result
  );
END;
$$;
