-- ============================================
-- Tijdzone per ronde
-- ============================================
-- PCS toont starttijden in de LOKALE tijd van de koers, maar sync-pcs-race las ze
-- altijd als CET/CEST. Voor races buiten Midden-Europa lag de deadline daardoor uren
-- verkeerd (Tour of Guangxi, UTC+8: 6 uur te laat — spelers konden nog kiezen
-- terwijl de etappe al reed). Nu rekent de import met competitions.timezone
-- (IANA-naam, _shared/tz.ts). Standaard Europe/Amsterdam = het oude gedrag, dus
-- bestaande rondes veranderen niet. Wijzigen na een import: opnieuw importeren
-- (bestaande etappes krijgen dan de herberekende start_time/deadline).

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Amsterdam';

-- Tour of Guangxi 2026 (China, UTC+8) — nog geen etappes geïmporteerd
UPDATE competitions SET timezone = 'Asia/Shanghai'
WHERE id = 41 AND name = 'Tour of Guangxi';
