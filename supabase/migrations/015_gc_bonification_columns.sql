-- ============================================
-- Voeg total_bonification en total_time_no_bonif toe aan general_classification
-- Zodat de frontend de snelste tijd kan tonen met en zonder bonificatie
-- ============================================

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
  -- Tijd zonder bonificatie (alleen tijdsverschillen)
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN (
        SELECT COALESCE(MAX(sr2.time_seconds) - MIN(sr2.time_seconds), 0)
        FROM stage_results sr2
        WHERE sr2.stage_id = pt.stage_id AND NOT sr2.dnf
      )
      ELSE GREATEST(pt.time_seconds - pt.winner_time, 0)
    END
  ) AS total_time_no_bonif,
  -- Totale bonificatie
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE bonification_seconds(pt.finish_position)
    END
  ) AS total_bonification,
  -- Tijd met bonificatie (= total_time_no_bonif - total_bonification)
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
      ELSE bonification_seconds(pt.finish_position)
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
