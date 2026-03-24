-- Add competition_id to riders so each competition has its own rider list
ALTER TABLE riders ADD COLUMN competition_id int REFERENCES competitions(id) ON DELETE CASCADE;

-- Drop old unique constraint on bib_number (was global, now per competition)
ALTER TABLE riders DROP CONSTRAINT IF EXISTS riders_bib_number_key;
ALTER TABLE riders ADD CONSTRAINT riders_competition_bib_unique UNIQUE(competition_id, bib_number);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_riders_competition ON riders(competition_id);

-- Backfill: assign existing riders to the first active competition (if any)
UPDATE riders SET competition_id = (
  SELECT id FROM competitions WHERE is_active = true LIMIT 1
) WHERE competition_id IS NULL;
