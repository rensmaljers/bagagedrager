-- ============================================
-- SPELREGELS: Puntensysteem, Deelpenalty, Rad van Fortuin
-- ============================================

-- 1. Nieuwe kolommen op stage_results
ALTER TABLE stage_results ADD COLUMN IF NOT EXISTS finish_position int;
ALTER TABLE stage_results ADD COLUMN IF NOT EXISTS game_points int NOT NULL DEFAULT 0;

-- 2. Nieuwe kolom op picks voor random toewijzing
ALTER TABLE picks ADD COLUMN IF NOT EXISTS is_random boolean NOT NULL DEFAULT false;

-- 3. Functie: positie → spelpunten
CREATE OR REPLACE FUNCTION position_to_game_points(pos int) RETURNS int AS $$
  SELECT CASE
    WHEN pos = 1 THEN 100
    WHEN pos = 2 THEN 80
    WHEN pos = 3 THEN 70
    WHEN pos = 4 THEN 60
    WHEN pos = 5 THEN 50
    WHEN pos = 6 THEN 40
    WHEN pos = 7 THEN 35
    WHEN pos = 8 THEN 30
    WHEN pos = 9 THEN 25
    WHEN pos = 10 THEN 20
    WHEN pos BETWEEN 11 AND 13 THEN 15
    WHEN pos BETWEEN 14 AND 15 THEN 10
    WHEN pos BETWEEN 16 AND 20 THEN 5
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

-- 4. Functie: deelpenalty multiplier
CREATE OR REPLACE FUNCTION sharing_multiplier(num_pickers int) RETURNS numeric AS $$
  SELECT CASE
    WHEN num_pickers <= 1 THEN 1.0
    WHEN num_pickers = 2 THEN 0.8
    WHEN num_pickers = 3 THEN 0.6
    WHEN num_pickers = 4 THEN 0.4
    ELSE 0.2
  END;
$$ LANGUAGE sql IMMUTABLE;

-- 5. Functie: bereken finish_position en game_points na results save
CREATE OR REPLACE FUNCTION calculate_game_points(p_stage_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  WITH ranked AS (
    SELECT id, dnf,
      ROW_NUMBER() OVER (ORDER BY dnf ASC, time_seconds ASC) AS pos
    FROM stage_results
    WHERE stage_id = p_stage_id
  )
  UPDATE stage_results sr
  SET finish_position = ranked.pos,
      game_points = CASE WHEN ranked.dnf THEN 0 ELSE position_to_game_points(ranked.pos::int) END
  FROM ranked
  WHERE sr.id = ranked.id;
END;
$$;

-- 6. Functie: Rad van Fortuin - wijs random renner toe aan spelers zonder keuze
CREATE OR REPLACE FUNCTION assign_random_riders(p_stage_id int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_comp_id int;
  v_user record;
  v_rider_id int;
  v_count int := 0;
BEGIN
  -- Haal competitie op
  SELECT competition_id INTO v_comp_id FROM stages WHERE id = p_stage_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Stage niet gevonden');
  END IF;

  -- Loop door alle spelers die al een keuze hebben in deze competitie maar niet voor deze etappe
  FOR v_user IN
    SELECT DISTINCT p.user_id
    FROM picks p
    JOIN stages s ON s.id = p.stage_id
    WHERE s.competition_id = v_comp_id
      AND p.user_id NOT IN (
        SELECT user_id FROM picks WHERE stage_id = p_stage_id
      )
  LOOP
    -- Kies een random renner die de speler nog niet gebruikt heeft in deze competitie
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

-- 7. Update admin_save_results om game_points te berekenen + rad van fortuin
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
    INSERT INTO stage_results (stage_id, rider_id, time_seconds, points, mountain_points, dnf)
    VALUES (
      p_stage_id,
      (v_item->>'rider_id')::int,
      (v_item->>'time_seconds')::int,
      coalesce((v_item->>'points')::int, 0),
      coalesce((v_item->>'mountain_points')::int, 0),
      coalesce((v_item->>'dnf')::boolean, false)
    )
    ON CONFLICT (stage_id, rider_id)
    DO UPDATE SET
      time_seconds = excluded.time_seconds,
      points = excluded.points,
      mountain_points = excluded.mountain_points,
      dnf = excluded.dnf;
    v_count := v_count + 1;
  END LOOP;

  -- Lock stage
  UPDATE stages SET locked = true WHERE id = p_stage_id;

  -- Bereken finish_position en game_points
  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object(
    'success', true,
    'count', v_count,
    'random_riders', v_random_result
  );
END;
$$;

-- 8. Update stage_picks_public view met game_points en deelpenalty
DROP VIEW IF EXISTS stage_picks_public;
CREATE VIEW stage_picks_public AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  GROUP BY stage_id, rider_id
)
SELECT
  p.stage_id,
  s.stage_number,
  s.competition_id,
  s.locked,
  s.deadline,
  p.user_id,
  pr.display_name,
  p.rider_id,
  r.name AS rider_name,
  r.team AS rider_team,
  r.bib_number,
  p.is_late,
  p.is_random,
  sr.time_seconds,
  sr.points,
  sr.mountain_points,
  sr.dnf,
  sr.finish_position,
  COALESCE(sr.game_points, 0) AS game_points,
  COALESCE(rpc.num_pickers, 1)::int AS num_pickers,
  CASE
    WHEN p.is_late THEN 0
    WHEN sr.dnf THEN 0
    ELSE FLOOR(COALESCE(sr.game_points, 0) * sharing_multiplier(COALESCE(rpc.num_pickers, 1)::int))::int
  END AS effective_game_points
FROM picks p
JOIN stages s ON s.id = p.stage_id
JOIN profiles pr ON pr.id = p.user_id
JOIN riders r ON r.id = p.rider_id
LEFT JOIN stage_results sr ON sr.stage_id = p.stage_id AND sr.rider_id = p.rider_id
LEFT JOIN rider_pick_counts rpc ON rpc.stage_id = p.stage_id AND rpc.rider_id = p.rider_id
WHERE s.locked = true OR s.deadline < now();

-- 9. Update general_classification view met game_points en deelpenalty
DROP VIEW IF EXISTS general_classification;
CREATE VIEW general_classification AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  GROUP BY stage_id, rider_id
),
pick_times AS (
  SELECT
    p.user_id,
    p.stage_id,
    p.rider_id,
    p.is_late,
    s.competition_id,
    COALESCE(sr.time_seconds, 0) AS time_seconds,
    CASE WHEN p.is_late THEN 0 ELSE COALESCE(sr.points, 0) END AS points,
    CASE WHEN p.is_late THEN 0 ELSE COALESCE(sr.mountain_points, 0) END AS mountain_points,
    COALESCE(sr.dnf, false) AS dnf,
    COALESCE(sr.game_points, 0) AS raw_game_points,
    COALESCE(rpc.num_pickers, 1)::int AS num_pickers
  FROM picks p
  JOIN stages s ON s.id = p.stage_id
  LEFT JOIN stage_results sr ON sr.stage_id = p.stage_id AND sr.rider_id = p.rider_id
  LEFT JOIN rider_pick_counts rpc ON rpc.stage_id = p.stage_id AND rpc.rider_id = p.rider_id
)
SELECT
  pt.competition_id,
  pt.user_id,
  pr.display_name,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN (
        SELECT COALESCE(MAX(sr2.time_seconds), 0)
        FROM stage_results sr2
        WHERE sr2.stage_id = pt.stage_id AND NOT sr2.dnf
      )
      ELSE pt.time_seconds
    END
  ) AS total_time,
  SUM(pt.points) AS total_points,
  SUM(pt.mountain_points) AS total_mountain_points,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE FLOOR(pt.raw_game_points * sharing_multiplier(pt.num_pickers))::int
    END
  ) AS total_game_points,
  COUNT(pt.stage_id) AS stages_played
FROM pick_times pt
JOIN profiles pr ON pr.id = pt.user_id
GROUP BY pt.competition_id, pt.user_id, pr.display_name;

-- 10. Starttijd = deadline: voeg start_time toe en sync met deadline
ALTER TABLE stages ADD COLUMN IF NOT EXISTS start_time timestamptz;

-- Backfill: zet start_time gelijk aan bestaande deadline
UPDATE stages SET start_time = deadline WHERE start_time IS NULL;

-- Trigger: bij insert of update van start_time, zet deadline automatisch gelijk
CREATE OR REPLACE FUNCTION sync_deadline_to_start_time()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.start_time IS NOT NULL THEN
    NEW.deadline := NEW.start_time;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_deadline ON stages;
CREATE TRIGGER trg_sync_deadline
  BEFORE INSERT OR UPDATE OF start_time ON stages
  FOR EACH ROW EXECUTE FUNCTION sync_deadline_to_start_time();

-- 11. Backfill: bereken game_points voor bestaande resultaten
DO $$
DECLARE
  v_stage record;
BEGIN
  FOR v_stage IN SELECT DISTINCT stage_id FROM stage_results
  LOOP
    PERFORM calculate_game_points(v_stage.stage_id);
  END LOOP;
END;
$$;
