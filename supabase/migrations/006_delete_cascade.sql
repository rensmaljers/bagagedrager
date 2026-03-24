-- Fix: allow admin to delete competitions
CREATE POLICY "Admin delete competitions" ON competitions FOR DELETE
  USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));

-- Fix: add CASCADE to foreign keys so deleting a stage/rider also removes related data

-- stage_results.stage_id -> stages(id)
ALTER TABLE stage_results DROP CONSTRAINT IF EXISTS stage_results_stage_id_fkey;
ALTER TABLE stage_results ADD CONSTRAINT stage_results_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE;

-- stage_results.rider_id -> riders(id)
ALTER TABLE stage_results DROP CONSTRAINT IF EXISTS stage_results_rider_id_fkey;
ALTER TABLE stage_results ADD CONSTRAINT stage_results_rider_id_fkey
  FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE;

-- picks.stage_id -> stages(id)
ALTER TABLE picks DROP CONSTRAINT IF EXISTS picks_stage_id_fkey;
ALTER TABLE picks ADD CONSTRAINT picks_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE;

-- picks.rider_id -> riders(id)
ALTER TABLE picks DROP CONSTRAINT IF EXISTS picks_rider_id_fkey;
ALTER TABLE picks ADD CONSTRAINT picks_rider_id_fkey
  FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE;

-- stages.competition_id -> competitions(id)
ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_competition_id_fkey;
ALTER TABLE stages ADD CONSTRAINT stages_competition_id_fkey
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
