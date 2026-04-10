-- ============================================
-- FIX 028: Toon correcte straftijd voor DNF in stage_picks_public
-- dnf_penalty_gap = slechtste tijdsverschil van een gekozen renner
-- die wél gefinisht is (zelfde logica als general_classification)
-- ============================================

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
  -- Straftijd voor DNF/te laat: slechtste tijdsverschil van een gekozen renner
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN (
      SELECT COALESCE(
        MAX(sr2.time_seconds) - (SELECT winner_time FROM stage_winner_times WHERE stage_id = p.stage_id),
        0
      )
      FROM stage_results sr2
      JOIN picks p2 ON p2.stage_id = p.stage_id AND p2.rider_id = sr2.rider_id
      WHERE sr2.stage_id = p.stage_id AND NOT sr2.dnf
    )
    ELSE NULL
  END AS dnf_penalty_gap,
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN 0
    ELSE COALESCE(sr.bonification_seconds, 0)
  END AS bonification,
  sr.points,
  sr.mountain_points,
  -- Punten: GEEN deelpenalty
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN 0
    ELSE COALESCE(sr.points, 0)
  END AS effective_points,
  -- Berg: GEEN deelpenalty
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) THEN 0
    ELSE COALESCE(sr.mountain_points, 0)
  END AS effective_mountain_points,
  sr.dnf,
  sr.finish_position,
  COALESCE(sr.game_points, 0) AS game_points,
  COALESCE(rpc.num_pickers, 1)::int AS num_pickers,
  -- Spelpunten: WEL deelpenalty
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
