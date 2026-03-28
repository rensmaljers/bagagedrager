-- ============================================
-- Extra etappe-informatie: afstand, start/finish, profielplaatje
-- ============================================

ALTER TABLE stages ADD COLUMN IF NOT EXISTS distance_km numeric;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS departure text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS arrival text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS profile_image_url text;
