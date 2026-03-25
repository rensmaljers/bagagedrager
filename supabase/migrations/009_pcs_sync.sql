-- PCS URL opslaan per competitie voor directe sync
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS pcs_url text;

-- Fix: riders.competition_id cascade was niet correct aangemaakt
ALTER TABLE riders DROP CONSTRAINT IF EXISTS riders_competition_id_fkey;
ALTER TABLE riders ADD CONSTRAINT riders_competition_id_fkey
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
