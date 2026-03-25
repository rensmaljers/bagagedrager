-- ============================================
-- ACCOUNT: Extra profielvelden
-- ============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS favorite_team text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cycling_hero text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS motto text;
