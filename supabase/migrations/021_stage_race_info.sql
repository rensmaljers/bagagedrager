-- Extra race-informatie per etappe (van PCS)
ALTER TABLE stages ADD COLUMN IF NOT EXISTS classification text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS race_category text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS parcours_type text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS profile_score int;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS vertical_meters int;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS avg_speed_winner text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS startlist_quality_score int;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS avg_temperature text;
