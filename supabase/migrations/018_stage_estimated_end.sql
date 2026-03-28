-- ============================================
-- Geschatte eindtijd per etappe (voor auto-sync)
-- Berekend als start_time + (distance_km / 40 km/u) + 1 uur buffer
-- ============================================

ALTER TABLE stages ADD COLUMN IF NOT EXISTS estimated_end_time timestamptz;
