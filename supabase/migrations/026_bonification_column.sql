-- ============================================
-- BONIFICATIE FIX: per-renner bonificatie opslaan i.p.v. afleiden uit positie
-- ============================================
-- Probleem: bonification_seconds(finish_position) gaf blind 10/6/4 aan top 3.
-- Fout in twee richtingen:
--   - Tijdritten kennen geen bonificatie → Vauquelin kreeg ten onrechte 10s
--   - Tussensprints kunnen ook bonificatie geven → iemand die 15e wordt
--     maar 3s pakte bij een tussensprint kreeg 0
-- Oplossing: kolom bonification_seconds in stage_results, ingevuld door
-- de scraper of handmatig door de admin. Views gebruiken dat veld direct.

ALTER TABLE stage_results
  ADD COLUMN IF NOT EXISTS bonification_seconds int NOT NULL DEFAULT 0;

-- Update views: gebruik sr.bonification_seconds i.p.v. bonification_seconds(finish_position)
DROP VIEW IF EXISTS general_classification;
CREATE VIEW general_classification AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  GROUP BY stage_id, rider_id
),
stage_winner_times AS (
  SELECT stage_id, time_seconds AS winner_time
  FROM stage_results
  WHERE finish_position = 1 AND NOT dnf AND time_seconds > 0
),
pick_times AS (
  SELECT
    p.user_id,
    p.stage_id,
    p.rider_id,
    p.is_late,
    s.competition_id,
    c.scoring_mode,
    COALESCE(sr.time_seconds, 0) AS time_seconds,
    COALESCE(swt.winner_time, 0) AS winner_time,
    COALESCE(sr.finish_position, 0) AS finish_position,
    COALESCE(sr.bonification_seconds, 0) AS bonus_seconds,
    CASE WHEN p.is_late THEN 0 ELSE COALESCE(sr.points, 0) END AS points,
    CASE WHEN p.is_late THEN 0 ELSE COALESCE(sr.mountain_points, 0) END AS mountain_points,
    COALESCE(sr.dnf, false) AS dnf,
    COALESCE(sr.game_points, 0) AS raw_game_points,
    COALESCE(rpc.num_pickers, 1)::int AS num_pickers
  FROM picks p
  JOIN stages s ON s.id = p.stage_id
  JOIN competitions c ON c.id = s.competition_id
  LEFT JOIN stage_results sr ON sr.stage_id = p.stage_id AND sr.rider_id = p.rider_id
  LEFT JOIN stage_winner_times swt ON swt.stage_id = p.stage_id
  LEFT JOIN rider_pick_counts rpc ON rpc.stage_id = p.stage_id AND rpc.rider_id = p.rider_id
)
SELECT
  pt.competition_id,
  pt.scoring_mode,
  pt.user_id,
  pr.display_name,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN (
        SELECT COALESCE(MAX(sr2.time_seconds) - MIN(sr2.time_seconds), 0)
        FROM stage_results sr2
        WHERE sr2.stage_id = pt.stage_id AND NOT sr2.dnf
      )
      ELSE GREATEST(pt.time_seconds - pt.winner_time, 0)
    END
  )
  -
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE pt.bonus_seconds
    END
  ) AS total_time,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE FLOOR(pt.points * sharing_multiplier(pt.num_pickers))::int
    END
  ) AS total_points,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE FLOOR(pt.mountain_points * sharing_multiplier(pt.num_pickers))::int
    END
  ) AS total_mountain_points,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE FLOOR(pt.raw_game_points * sharing_multiplier(pt.num_pickers))::int
    END
  ) AS total_game_points,
  COUNT(pt.stage_id) AS stages_played
FROM pick_times pt
JOIN profiles pr ON pr.id = pt.user_id
GROUP BY pt.competition_id, pt.scoring_mode, pt.user_id, pr.display_name;

DROP VIEW IF EXISTS stage_picks_public;
CREATE VIEW stage_picks_public AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  GROUP BY stage_id, rider_id
),
stage_winner_times AS (
  SELECT stage_id, time_seconds AS winner_time
  FROM stage_results
  WHERE finish_position = 1 AND NOT dnf AND time_seconds > 0
)
SELECT
  p.stage_id,
  s.stage_number,
  s.competition_id,
  c.scoring_mode,
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
  GREATEST(COALESCE(sr.time_seconds, 0) - COALESCE(swt.winner_time, 0), 0) AS time_gap,
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN 0
    ELSE COALESCE(sr.bonification_seconds, 0)
  END AS bonification,
  sr.points,
  sr.mountain_points,
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN 0
    ELSE FLOOR(COALESCE(sr.points, 0) * sharing_multiplier(COALESCE(rpc.num_pickers, 1)::int))::int
  END AS effective_points,
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN 0
    ELSE FLOOR(COALESCE(sr.mountain_points, 0) * sharing_multiplier(COALESCE(rpc.num_pickers, 1)::int))::int
  END AS effective_mountain_points,
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
JOIN competitions c ON c.id = s.competition_id
JOIN profiles pr ON pr.id = p.user_id
JOIN riders r ON r.id = p.rider_id
LEFT JOIN stage_results sr ON sr.stage_id = p.stage_id AND sr.rider_id = p.rider_id
LEFT JOIN stage_winner_times swt ON swt.stage_id = p.stage_id
LEFT JOIN rider_pick_counts rpc ON rpc.stage_id = p.stage_id AND rpc.rider_id = p.rider_id
WHERE s.locked = true OR s.deadline < now();

-- Reset alle bestaande bonificaties die nog op basis van finish_position waren
-- (de scraper en handmatige inputs vullen ze opnieuw). Hierdoor klopt de
-- huidige tijdrit-uitslag direct na deze migration.
UPDATE stage_results SET bonification_seconds = 0;

-- Update admin_save_results om ook bonification_seconds te accepteren
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

  SELECT assign_random_riders(p_stage_id) INTO v_random_result;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    INSERT INTO stage_results (stage_id, rider_id, time_seconds, finish_position, points, mountain_points, dnf, bonification_seconds)
    VALUES (
      p_stage_id,
      (v_item->>'rider_id')::int,
      (v_item->>'time_seconds')::int,
      (v_item->>'finish_position')::int,
      coalesce((v_item->>'points')::int, 0),
      coalesce((v_item->>'mountain_points')::int, 0),
      coalesce((v_item->>'dnf')::boolean, false),
      coalesce((v_item->>'bonification_seconds')::int, 0)
    )
    ON CONFLICT (stage_id, rider_id)
    DO UPDATE SET
      time_seconds = excluded.time_seconds,
      finish_position = excluded.finish_position,
      points = excluded.points,
      mountain_points = excluded.mountain_points,
      dnf = excluded.dnf,
      bonification_seconds = excluded.bonification_seconds;
    v_count := v_count + 1;
  END LOOP;

  UPDATE stages SET locked = true WHERE id = p_stage_id;
  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object(
    'success', true,
    'count', v_count,
    'random', v_random_result
  );
END;
$$;
