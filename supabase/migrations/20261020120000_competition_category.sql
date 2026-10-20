-- ============================================
-- Categorie per ronde (voor groeperen in de spelergeschiedenis)
-- ============================================
-- De geschiedenis in de speler-detailmodal groepeert rondes per categorie
-- (Grote rondes / WorldTour / Klassiekers / Vrouwenkoersen). Afleiden uit de
-- naam is te foutgevoelig, dus een vaste kolom die de admin per ronde kiest
-- (Admin → Rondes). Backfill hieronder op basis van PCS-slug, naam en modus.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'worldtour';

DO $$ BEGIN
  ALTER TABLE competitions ADD CONSTRAINT competitions_category_check
    CHECK (category IN ('grote_ronde', 'worldtour', 'klassieker', 'vrouwen'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Volgorde telt: vrouwen vóór grote ronde (Tour de France Femmes ≠ Tour de France)
UPDATE competitions SET category = 'vrouwen'
WHERE name ~* '(femmes|women|donne|féminin|feminas|ladies)'
   OR pcs_url ~* '(femmes|women|donne|feminas)';

UPDATE competitions SET category = 'grote_ronde'
WHERE category = 'worldtour'
  AND pcs_url ~* 'race/(giro-d-italia|tour-de-france|vuelta-a-espana)/';

UPDATE competitions SET category = 'klassieker'
WHERE category = 'worldtour' AND scoring_mode = 'classic';
