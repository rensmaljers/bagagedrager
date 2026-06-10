-- ============================================
-- 058: Picks van anderen pas leesbaar na de deadline
-- ============================================
-- De oude policy "Public read picks" was USING (true): iedereen kon via de
-- REST-API alle keuzes van alle spelers zien, ook vóór de deadline.
-- De UI verborg dit, de API niet. Nieuw:
--   1. eigen picks altijd leesbaar
--   2. picks van anderen pas als de etappe locked is of de deadline voorbij
--   3. admins lezen alles (admin-panel toont picks van andere spelers)
-- Klassement-views (general_classification, stage_picks_public) draaien als
-- view-owner en blijven ongewijzigd werken.

DROP POLICY IF EXISTS "Public read picks" ON picks;
DROP POLICY IF EXISTS "Eigen picks lezen" ON picks;
DROP POLICY IF EXISTS "Picks van anderen na deadline" ON picks;
DROP POLICY IF EXISTS "Admin leest alle picks" ON picks;

CREATE POLICY "Eigen picks lezen" ON picks
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Picks van anderen na deadline" ON picks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM stages s
      WHERE s.id = picks.stage_id
        AND (s.locked OR s.deadline < now())
    )
  );

CREATE POLICY "Admin leest alle picks" ON picks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );
