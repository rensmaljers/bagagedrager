-- Correctie: Tour de France Femmes (id 42) stond als jaar 2025, terwijl de
-- ronde (PCS-link race/tour-de-france-femmes/2026, slug TdF-femmes-2026) die
-- van 2026 is. Het jaar is in Admin niet bewerkbaar, daarom via een migratie.
-- Voorwaarden in de WHERE zodat dit nergens anders iets raakt.
UPDATE competitions SET year = 2026
WHERE id = 42
  AND name = 'Tour de France Femmes'
  AND year = 2025
  AND pcs_url LIKE '%tour-de-france-femmes/2026%';
