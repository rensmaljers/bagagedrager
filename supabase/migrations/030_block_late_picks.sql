-- ============================================
-- FIX 030: Blokkeer alle picks na de deadline (nieuw én wijzigen)
-- Eerder werd alleen het WIJZIGEN geblokkeerd. Een nieuwe pick na
-- de deadline werd nog opgeslagen met is_late=true.
-- ============================================

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

  -- Na de deadline: geen enkele keuze meer mogelijk
  IF v_is_late THEN
    RAISE EXCEPTION 'Etappe is vergrendeld, keuze kan niet meer gewijzigd worden';
  END IF;

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

  INSERT INTO picks (user_id, stage_id, rider_id, is_late, submitted_at)
  VALUES (v_user_id, p_stage_id, p_rider_id, false, now())
  ON CONFLICT (user_id, stage_id)
  DO UPDATE SET rider_id = p_rider_id, is_late = false, submitted_at = now()
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'success', true,
    'pick_id', v_result.id,
    'is_late', false
  );
END;
$$;
