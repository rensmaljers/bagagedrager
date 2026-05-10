-- ============================================
-- 046: Correcte resultaten etappe 2 Giro 2026
--
-- Ciccone: scraper zette positie 155/tijd 21058 (fout door cells<8 bug).
-- Correct: positie 3, tijd 20365 (z.t. met winnaar), bonif 4s.
-- AULAR: ontbrak volledig (pcs_slug match ging naar verkeerde rider_id).
-- Correct: positie 46, tijd 20426 (z.t. LØLAND +1:01), bonif 0.
-- Beide gemarkeerd als manually_edited zodat toekomstige syncs ze overslaan.
-- ============================================

-- Ciccone (rider_id=5242, stage 145)
UPDATE stage_results
SET finish_position = 3,
    time_seconds    = 20365,
    bonification_seconds = 4,
    dnf             = false,
    manually_edited = true
WHERE stage_id = 145 AND rider_id = 5242;

-- AULAR (rider_id=5259, stage 145)
INSERT INTO stage_results (stage_id, rider_id, finish_position, time_seconds, points, mountain_points, bonification_seconds, game_points, dnf, manually_edited)
VALUES (145, 5259, 46, 20426, 0, 0, 0, 0, false, true)
ON CONFLICT (stage_id, rider_id) DO UPDATE SET
  finish_position      = 46,
  time_seconds         = 20426,
  bonification_seconds = 0,
  dnf                  = false,
  manually_edited      = true;

-- Herbereken game_points voor stage 145
SELECT calculate_game_points(145);
