-- ============================================
-- FIX 031: rad_assigned vlag op stages
-- Zorgt dat het Rad van Fortuin precies één keer per etappe draait
-- (op het moment van de deadline, via de cron Edge Function)
-- ============================================

ALTER TABLE stages ADD COLUMN IF NOT EXISTS rad_assigned boolean NOT NULL DEFAULT false;
