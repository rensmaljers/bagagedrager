-- Globale renners tabel: één rij per renner, gedeeld over alle competities
-- Foto en persoonlijke data hier opgeslagen — bibnummer/team/dnf blijft per competitie in riders

CREATE TABLE IF NOT EXISTS global_riders (
  id SERIAL PRIMARY KEY,
  pcs_slug TEXT UNIQUE NOT NULL,
  name TEXT,
  photo_url TEXT,
  nationality TEXT,
  date_of_birth DATE,
  weight_kg NUMERIC(5,1),
  height_m NUMERIC(4,2),
  specialty_one_day INT,
  specialty_gc INT,
  specialty_tt INT,
  specialty_sprint INT,
  specialty_climber INT,
  specialty_hills INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE global_riders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read global_riders" ON global_riders FOR SELECT USING (true);

-- FK van riders naar global_riders
ALTER TABLE riders ADD COLUMN IF NOT EXISTS global_rider_id INT REFERENCES global_riders(id);

-- Migreer bestaande data: één global record per pcs_slug (voorkeur voor rijen met foto)
INSERT INTO global_riders (pcs_slug, name, photo_url, nationality, date_of_birth, weight_kg, height_m,
  specialty_one_day, specialty_gc, specialty_tt, specialty_sprint, specialty_climber, specialty_hills)
SELECT DISTINCT ON (pcs_slug)
  pcs_slug, name, photo_url, nationality, date_of_birth, weight_kg, height_m,
  specialty_one_day, specialty_gc, specialty_tt, specialty_sprint, specialty_climber, specialty_hills
FROM riders
WHERE pcs_slug IS NOT NULL
ORDER BY pcs_slug,
  (photo_url IS NOT NULL AND photo_url LIKE 'http%') DESC,
  id DESC
ON CONFLICT (pcs_slug) DO NOTHING;

-- Koppel bestaande riders aan hun global record
UPDATE riders r
SET global_rider_id = gr.id
FROM global_riders gr
WHERE r.pcs_slug = gr.pcs_slug
  AND r.global_rider_id IS NULL;

-- Trigger: als global_riders.photo_url wijzigt, sync naar alle gekoppelde riders
CREATE OR REPLACE FUNCTION sync_global_photo_to_riders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.photo_url IS DISTINCT FROM OLD.photo_url THEN
    UPDATE riders SET photo_url = NEW.photo_url
    WHERE global_rider_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_global_photo ON global_riders;
CREATE TRIGGER trg_sync_global_photo
AFTER UPDATE ON global_riders
FOR EACH ROW EXECUTE FUNCTION sync_global_photo_to_riders();
