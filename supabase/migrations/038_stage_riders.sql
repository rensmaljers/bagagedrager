-- ============================================
-- 038: Per-etappe startlijst (stage_riders)
--
-- Heuvel klassiekers: niet elke renner start in elke koers.
-- stage_riders koppelt welke renners aan welke etappe meedoen.
-- Als er geen entries zijn voor een etappe, geldt de volledige
-- competitie-startlijst (backward compatible voor grote rondes).
-- ============================================

CREATE TABLE IF NOT EXISTS stage_riders (
  stage_id int REFERENCES stages(id) ON DELETE CASCADE,
  rider_id int REFERENCES riders(id) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_riders_stage ON stage_riders(stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_riders_rider ON stage_riders(rider_id);

ALTER TABLE stage_riders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stage_riders_public_read" ON stage_riders FOR SELECT USING (true);

-- Update assign_random_riders: gebruik stage_riders als die beschikbaar zijn
CREATE OR REPLACE FUNCTION assign_random_riders(p_stage_id int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_comp_id int;
  v_user record;
  v_rider_id int;
  v_count int := 0;
  v_has_stage_riders boolean;
BEGIN
  SELECT competition_id INTO v_comp_id FROM stages WHERE id = p_stage_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Stage niet gevonden');
  END IF;

  -- Controleer of er stage-specifieke startlijst bestaat
  SELECT EXISTS(SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id) INTO v_has_stage_riders;

  -- Loop door spelers die al een keuze hebben in deze competitie maar niet voor deze etappe
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
      AND (
        NOT v_has_stage_riders
        OR r.id IN (SELECT rider_id FROM stage_riders WHERE stage_id = p_stage_id)
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
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_count);
END;
$$;

-- Update submit_pick: valideer tegen stage_riders als die aanwezig zijn
CREATE OR REPLACE FUNCTION submit_pick(p_stage_id int, p_rider_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_stage record;
  v_comp_id int;
  v_already_used boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  SELECT * INTO v_stage FROM stages WHERE id = p_stage_id;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Etappe niet gevonden';
  END IF;

  IF (now() > v_stage.deadline) OR v_stage.locked THEN
    RAISE EXCEPTION 'Etappe is vergrendeld, keuze kan niet meer gewijzigd worden';
  END IF;

  v_comp_id := v_stage.competition_id;

  -- Controleer of renner in de startlijst staat (als stage_riders gevuld is voor deze etappe)
  IF EXISTS(SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id) THEN
    IF NOT EXISTS(SELECT 1 FROM stage_riders WHERE stage_id = p_stage_id AND rider_id = p_rider_id) THEN
      RAISE EXCEPTION 'Deze renner start niet in deze etappe';
    END IF;
  END IF;

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
  DO UPDATE SET rider_id = p_rider_id, is_late = false, submitted_at = now();

  RETURN jsonb_build_object('success', true, 'is_late', false);
END;
$$;
