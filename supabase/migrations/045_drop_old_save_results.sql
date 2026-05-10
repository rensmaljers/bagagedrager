-- ============================================
-- 045: Verwijder oude admin_save_results overload
--
-- Migration 044 voegde p_manual parameter toe via CREATE OR REPLACE,
-- maar omdat de signature verschilt maakt Postgres een nieuw overload
-- i.p.v. de oude te vervangen → ambiguous function error.
-- Drop de oude (2-arg) versie expliciet.
-- ============================================

DROP FUNCTION IF EXISTS admin_save_results(int, jsonb);
