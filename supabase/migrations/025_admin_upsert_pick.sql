-- ============================================
-- ADMIN: upsert/delete pick voor andere speler (met terugwerkende kracht)
-- ============================================
-- Laat admins handmatig keuzes invullen of wijzigen voor andere gebruikers,
-- bijv. wanneer een speler vergat in te vullen maar de keuze wel had
-- doorgegeven. Werkt ook op locked stages. Controleert dat de renner niet al
-- in een andere etappe door deze speler gebruikt is.

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

  -- Check dat de renner niet al door deze speler in een andere etappe
  -- van dezelfde competitie gebruikt is
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
    is_late = excluded.is_late,
    is_random = false;

  -- Herbereken game_points zodat sharing-multipliers meteen kloppen
  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_upsert_pick(uuid, int, int, boolean) TO authenticated;

-- Admin kan ook een pick verwijderen
CREATE OR REPLACE FUNCTION admin_delete_pick(
  p_user_id uuid,
  p_stage_id int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  DELETE FROM picks WHERE user_id = p_user_id AND stage_id = p_stage_id;

  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_pick(uuid, int) TO authenticated;
