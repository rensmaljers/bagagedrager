-- PCS URL opslaan per competitie voor directe sync
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS pcs_url text;

-- Fix: riders.competition_id cascade was niet correct aangemaakt
ALTER TABLE riders DROP CONSTRAINT IF EXISTS riders_competition_id_fkey;
ALTER TABLE riders ADD CONSTRAINT riders_competition_id_fkey
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;

-- Performance: composite indexes voor veelgebruikte queries
CREATE INDEX IF NOT EXISTS idx_stage_results_stage_rider ON stage_results(stage_id, rider_id);
CREATE INDEX IF NOT EXISTS idx_picks_stage_rider ON picks(stage_id, rider_id);
CREATE INDEX IF NOT EXISTS idx_stages_locked_deadline ON stages(locked, deadline);
