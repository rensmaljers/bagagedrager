-- ============================================
-- 078: payment_url per competitie
--
-- De inleg-banner was hardcoded op "Tour de France 2026" (comp-naam-check,
-- Rabobank-betaalverzoeklink en localStorage-key) — bij een nieuwe ronde bleef
-- de banner dus voor altijd verborgen voor iedereen die de oude al had
-- weggeklikt. payment_url maakt de betaallink admin-configureerbaar per
-- competitie; de comp-naam-check en localStorage-key worden losgekoppeld
-- van "Tour de France 2026" in de frontend (Dashboard.svelte).
-- ============================================

ALTER TABLE competitions ADD COLUMN payment_url text;

-- Bestaande TdF-inleglink overzetten zodat de lopende ronde niet breekt
UPDATE competitions
SET payment_url = 'https://betaalverzoek.rabobank.nl/betaalverzoek/?id=aS3cgsxLTTGy-w-qM-B95A'
WHERE name = 'Tour de France 2026';
