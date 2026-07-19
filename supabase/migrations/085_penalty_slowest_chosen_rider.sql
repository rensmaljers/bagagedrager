-- ============================================
-- 085: DNF/DNS/te-laat-straf = traagste GEKOZEN renner (Rad uitgezonderd)
--
-- Aanleiding: spelersfeedback (Tour 2026, etappe 15). Migratie 063 zette de
-- straf voor niet-finishen/te-laat op de hekkensluiter van het HELE veld. De
-- bedoeling van het spel is echter: je krijgt de traagste tijd van een door
-- spelers GEKOZEN renner (de renner van iemands pick), met het Rad van Fortuin
-- (is_random) uitgezonderd. Te-late picks tellen wél mee in die pool — het is
-- nog steeds een bewust gekozen renner ("exclusief het rad").
--
-- Voorbeeld etappe 15: veld-hekkensluiter = +38:40, maar de traagste gekozen
-- renner (Arensman) = +25:00 — dat laatste is wat spelers verwachten.
--
-- De straf-TRIGGER blijft gelijk (is_late OR dnf OR geen finishpositie → dekt
-- DNF, DNS én te-laat); alleen de WAARDE verandert. Om de drie plekken (2× in
-- general_classification, 1× in stage_picks_public) gegarandeerd consistent te
-- houden zit de logica nu in één functie chosen_penalty_gap(stage).
--
-- chosen_penalty_gap is SECURITY DEFINER: hij moet ALLE picks kunnen zien om de
-- pool te bepalen; als SECURITY INVOKER zou de RLS op picks de uitkomst laten
-- afhangen van wie de view bevraagt. Hij geeft enkel een tijd-int terug (geen
-- pick-data lekt). Fallback: geen gekozen finisher → hekkensluiter hele veld → 0.
-- ============================================

CREATE OR REPLACE FUNCTION chosen_penalty_gap(p_stage_id int)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    COALESCE(
      -- traagste finisher die door minstens één niet-Rad-pick gekozen is
      (SELECT MAX(sr.time_seconds) FROM stage_results sr
         WHERE sr.stage_id = p_stage_id AND NOT sr.dnf AND sr.time_seconds > 0
           AND EXISTS (SELECT 1 FROM picks pk
                       WHERE pk.stage_id = sr.stage_id AND pk.rider_id = sr.rider_id
                         AND NOT pk.is_random)),
      -- fallback: geen gekozen finisher → traagste van het hele veld
      (SELECT MAX(sr.time_seconds) FROM stage_results sr
         WHERE sr.stage_id = p_stage_id AND NOT sr.dnf AND sr.time_seconds > 0)
    )
    - (SELECT COALESCE(s.winner_time_seconds,
                (SELECT time_seconds FROM stage_results
                   WHERE stage_id = p_stage_id AND finish_position = 1 AND NOT dnf AND time_seconds > 0
                   LIMIT 1))
         FROM stages s WHERE s.id = p_stage_id),
    0);
$$;

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
      WHEN pt.is_late OR pt.dnf THEN chosen_penalty_gap(pt.stage_id)
      ELSE GREATEST(pt.time_seconds - pt.winner_time, 0)
    END
  ) AS total_time_no_bonif,
  SUM(CASE WHEN pt.is_late OR pt.dnf THEN 0 ELSE pt.bonus_seconds END) AS total_bonification,
  SUM(
    CASE
      WHEN pt.is_late OR pt.dnf THEN chosen_penalty_gap(pt.stage_id)
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
    WHEN p.is_late OR COALESCE(sr.dnf, false) OR sr.finish_position IS NULL
      THEN chosen_penalty_gap(p.stage_id)
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
