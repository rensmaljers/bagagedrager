-- PCS URL opslaan per competitie voor directe sync
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS pcs_url text;
