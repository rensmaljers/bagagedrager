-- Klassiekers: elke etappe kan een eigen PCS URL hebben (voor gebundelde eendagskoersen)
ALTER TABLE stages ADD COLUMN IF NOT EXISTS pcs_url text;