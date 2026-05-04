-- ============================================
-- 040: Strijdlust klassement
--
-- Voegt total_combativity_points toe aan general_classification:
-- 1 punt per etappe waarbij de speler de etappewinnaar correct voorspelde
-- (finish_position = 1, niet te laat, niet DNF).
-- ============================================

DROP VIEW IF EXISTS general_classification;
CREATE VIEW general_classification AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  GROUP BY stage_id, rider_id
),
stage_winner_times AS (
  SELECT
    s.id AS stage_id,
    COALESCE(
      s.winner_time_seconds,
      fp.time_seconds
    ) AS winner_time
  FROM stages s
  LEFT JOIN LATERAL (
    SELECT time_seconds FROM stage_results
    WHERE stage_id = s.id AND finish_position = 1 AND NOT dnf AND time_seconds > 0
    LIMIT 1
  ) fp ON TRUE
  WHERE s.winner_time_seconds IS NOT NULL OR fp.time_seconds IS NOT NULL
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
        SELECT COALESCE(
          MAX(sr2.time_seconds) - (SELECT winner_time FROM stage_winner_times WHERE stage_id = pt.stage_id),
          0
        )
        FROM stage_results sr2
        JOIN picks p2 ON p2.stage_id = pt.stage_id AND p2.rider_id = sr2.rider_id
        WHERE sr2.stage_id = pt.stage_id AND NOT sr2.dnf
      )
      ELSE GREATEST(pt.time_seconds - pt.winner_time, 0)
    END
  ) AS total_time_no_bonif,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE pt.bonus_seconds
    END
  ) AS total_bonification,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN (
        SELECT COALESCE(
          MAX(sr2.time_seconds) - (SELECT winner_time FROM stage_winner_times WHERE stage_id = pt.stage_id),
          0
        )
        FROM stage_results sr2
        JOIN picks p2 ON p2.stage_id = pt.stage_id AND p2.rider_id = sr2.rider_id
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
      ELSE pt.points
    END
  ) AS total_points,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE pt.mountain_points
    END
  ) AS total_mountain_points,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN 0
      ELSE FLOOR(pt.raw_game_points * sharing_multiplier(pt.num_pickers))::int
    END
  ) AS total_game_points,
  SUM(
    CASE
      WHEN NOT pt.is_late AND NOT pt.dnf AND pt.finish_position = 1 THEN 1
      ELSE 0
    END
  ) AS total_combativity_points,
  COUNT(pt.stage_id) AS stages_played
FROM pick_times pt
JOIN profiles pr ON pr.id = pt.user_id
GROUP BY pt.competition_id, pt.scoring_mode, pt.user_id, pr.display_name;
