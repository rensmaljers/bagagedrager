-- ============================================
-- Voeg is_one_day veld toe aan competitions
-- Eendagskoersen hebben geen /stage-N suffix op PCS
-- ============================================

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS is_one_day boolean NOT NULL DEFAULT false;

-- Backfill: klassiekers zijn typisch eendagskoersen
UPDATE competitions SET is_one_day = true WHERE competition_type = 'classic';
