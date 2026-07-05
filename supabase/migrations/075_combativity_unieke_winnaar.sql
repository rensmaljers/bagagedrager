-- ============================================
-- 075: strijdlust telt de UNIEKE etappewinnaar (audit 5 juli 2026)
--
-- total_combativity_points telde elke pick met finish_position = 1. Bij een
-- ploegentijdrit of een gelijke tijd kunnen meerdere renners finish_position=1
-- hebben — dan kreeg iedereen die één van die renners koos een strijdlustpunt,
-- terwijl "etappewinnaar geraden" over één renner per etappe hoort te gaan.
-- Nu: de winnaar is de renner met finish_position=1, deterministisch ontdubbeld
-- op laagste tijd, dan laagste rider_id (stage_winner_rider). Alleen wie exact
-- die renner koos scoort het strijdlustpunt.
--
-- Verder identiek aan migratie 074 (deelpenalty op scorende picks). Beide views
-- opnieuw volledig gedefinieerd zodat de hoogst genummerde migratie leidend blijft.
-- ============================================

DROP VIEW IF EXISTS general_classification;
CREATE VIEW general_classification AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  WHERE NOT is_late AND NOT is_random
  GROUP BY stage_id, rider_id
),
stage_winner_times AS (
  SELECT
    s.id AS stage_id,
    COALESCE(s.winner_time_seconds, fp.time_seconds) AS winner_time
  FROM stages s
  LEFT JOIN LATERAL (
    SELECT time_seconds FROM stage_results
    WHERE stage_id = s.id AND finish_position = 1 AND NOT dnf AND time_seconds > 0
    LIMIT 1
  ) fp ON TRUE
  WHERE s.winner_time_seconds IS NOT NULL OR fp.time_seconds IS NOT NULL
),
-- Eén winnaar-renner per etappe (ontdubbeld bij gedeelde finish_position=1)
stage_winner_rider AS (
  SELECT DISTINCT ON (stage_id) stage_id, rider_id
  FROM stage_results
  WHERE finish_position = 1 AND NOT dnf
  ORDER BY stage_id, time_seconds NULLS LAST, rider_id
),
pick_times AS (
  SELECT
    p.user_id, p.stage_id, p.rider_id, p.is_late,
    s.competition_id, c.scoring_mode,
    COALESCE(sr.time_seconds, 0) AS time_seconds,
    COALESCE(swt.winner_time, 0) AS winner_time,
    COALESCE(sr.finish_position, 0) AS finish_position,
    COALESCE(sr.bonification_seconds, 0) AS bonus_seconds,
    CASE WHEN p.is_late THEN 0 ELSE COALESCE(sr.points, 0) END AS points,
    CASE WHEN p.is_late THEN 0 ELSE COALESCE(sr.mountain_points, 0) END AS mountain_points,
    (COALESCE(sr.dnf, false) OR sr.finish_position IS NULL) AS dnf,
    COALESCE(sr.game_points, 0) AS raw_game_points,
    COALESCE(rpc.num_pickers, 1)::int AS num_pickers,
    (swr.rider_id IS NOT NULL AND swr.rider_id = p.rider_id) AS is_stage_winner
  FROM picks p
  JOIN stages s ON s.id = p.stage_id
  JOIN competitions c ON c.id = s.competition_id
  LEFT JOIN stage_results sr ON sr.stage_id = p.stage_id AND sr.rider_id = p.rider_id
  LEFT JOIN stage_winner_times swt ON swt.stage_id = p.stage_id
  LEFT JOIN rider_pick_counts rpc ON rpc.stage_id = p.stage_id AND rpc.rider_id = p.rider_id
  LEFT JOIN stage_winner_rider swr ON swr.stage_id = p.stage_id
)
SELECT
  pt.competition_id, pt.scoring_mode, pt.user_id, pr.display_name,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN COALESCE(
        (SELECT MAX(sr3.time_seconds) - (SELECT winner_time FROM stage_winner_times WHERE stage_id = pt.stage_id)
           FROM stage_results sr3 WHERE sr3.stage_id = pt.stage_id AND NOT sr3.dnf), 0)
      ELSE GREATEST(pt.time_seconds - pt.winner_time, 0)
    END
  ) AS total_time_no_bonif,
  SUM(CASE WHEN pt.is_late OR pt.dnf THEN 0 ELSE pt.bonus_seconds END) AS total_bonification,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN COALESCE(
        (SELECT MAX(sr3.time_seconds) - (SELECT winner_time FROM stage_winner_times WHERE stage_id = pt.stage_id)
           FROM stage_results sr3 WHERE sr3.stage_id = pt.stage_id AND NOT sr3.dnf), 0)
      ELSE GREATEST(pt.time_seconds - pt.winner_time, 0)
    END
  ) - SUM(CASE WHEN pt.is_late OR pt.dnf THEN 0 ELSE pt.bonus_seconds END) AS total_time,
  SUM(CASE WHEN pt.is_late OR pt.dnf THEN 0 ELSE pt.points END) AS total_points,
  SUM(CASE WHEN pt.is_late OR pt.dnf THEN 0 ELSE pt.mountain_points END) AS total_mountain_points,
  SUM(CASE WHEN pt.is_late OR pt.dnf THEN 0 ELSE FLOOR(pt.raw_game_points * sharing_multiplier(pt.num_pickers))::int END) AS total_game_points,
  SUM(CASE WHEN NOT pt.is_late AND NOT pt.dnf AND pt.is_stage_winner THEN 1 ELSE 0 END) AS total_combativity_points,
  COUNT(pt.stage_id) AS stages_played
FROM pick_times pt
JOIN profiles pr ON pr.id = pt.user_id
GROUP BY pt.competition_id, pt.scoring_mode, pt.user_id, pr.display_name;

DROP VIEW IF EXISTS stage_picks_public;
CREATE VIEW stage_picks_public AS
WITH rider_pick_counts AS (
  SELECT stage_id, rider_id, COUNT(*) AS num_pickers
  FROM picks
  WHERE NOT is_late AND NOT is_random
  GROUP BY stage_id, rider_id
),
stage_winner_times AS (
  SELECT
    s.id AS stage_id,
    COALESCE(s.winner_time_seconds, fp.time_seconds) AS winner_time
  FROM stages s
  LEFT JOIN LATERAL (
    SELECT time_seconds FROM stage_results
    WHERE stage_id = s.id AND finish_position = 1 AND NOT dnf AND time_seconds > 0
    LIMIT 1
  ) fp ON TRUE
  WHERE s.winner_time_seconds IS NOT NULL OR fp.time_seconds IS NOT NULL
)
SELECT
  p.stage_id, s.stage_number, s.competition_id, c.scoring_mode,
  s.locked, s.deadline, s.winner_name,
  p.user_id, pr.display_name, p.rider_id,
  r.name AS rider_name, r.team AS rider_team, r.bib_number,
  p.is_late, p.is_random,
  sr.time_seconds,
  GREATEST(COALESCE(sr.time_seconds, 0) - COALESCE(swt.winner_time, 0), 0) AS time_gap,
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) OR sr.finish_position IS NULL THEN COALESCE(
      (SELECT MAX(sr3.time_seconds) - (SELECT winner_time FROM stage_winner_times WHERE stage_id = p.stage_id)
         FROM stage_results sr3 WHERE sr3.stage_id = p.stage_id AND NOT sr3.dnf), 0)
    ELSE NULL
  END AS dnf_penalty_gap,
  CASE
    WHEN p.is_late OR COALESCE(sr.dnf, false) OR sr.finish_position IS NULL THEN 0
    ELSE COALESCE(sr.bonification_seconds, 0)
  END AS bonification,
  sr.points, sr.mountain_points,
  CASE WHEN p.is_late OR COALESCE(sr.dnf, false) OR sr.finish_position IS NULL THEN 0 ELSE COALESCE(sr.points, 0) END AS effective_points,
  CASE WHEN p.is_late OR COALESCE(sr.dnf, false) OR sr.finish_position IS NULL THEN 0 ELSE COALESCE(sr.mountain_points, 0) END AS effective_mountain_points,
  sr.dnf, sr.finish_position,
  COALESCE(sr.game_points, 0) AS game_points,
  COALESCE(rpc.num_pickers, 1)::int AS num_pickers,
  CASE
    WHEN p.is_late THEN 0
    WHEN COALESCE(sr.dnf, false) OR sr.finish_position IS NULL THEN 0
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
