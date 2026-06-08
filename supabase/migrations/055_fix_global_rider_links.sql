-- Herstel bestaande renners waarbij global_rider_id null is maar pcs_slug wel bestaat
-- Dit kon voorkomen als een renner werd toegevoegd vóór migration 054, of als de sync
-- geen global record aanmaakte voor nieuwe renners
UPDATE riders r
SET global_rider_id = gr.id
FROM global_riders gr
WHERE r.pcs_slug = gr.pcs_slug
  AND r.global_rider_id IS NULL;

-- Propageer foto's naar renners waarbij global_rider_id nu gezet is maar photo_url nog null
-- (foto stond al in global_riders maar was nooit doorgekomen via de trigger)
UPDATE riders r
SET photo_url = gr.photo_url
FROM global_riders gr
WHERE r.global_rider_id = gr.id
  AND gr.photo_url IS NOT NULL
  AND gr.photo_url LIKE 'http%'
  AND (r.photo_url IS NULL OR r.photo_url NOT LIKE 'http%');

-- Update trigger: ook bij INSERT in global_riders foto doorzetten naar riders
-- Voorheen alleen AFTER UPDATE — als een global record nieuw aangemaakt werd (INSERT)
-- werd de foto niet doorgezet naar riders, ook al hadden die global_rider_id al gezet
CREATE OR REPLACE FUNCTION sync_global_photo_to_riders()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.photo_url IS NOT NULL AND NEW.photo_url LIKE 'http%')
     OR (TG_OP = 'UPDATE' AND NEW.photo_url IS DISTINCT FROM OLD.photo_url) THEN
    UPDATE riders SET photo_url = NEW.photo_url
    WHERE global_rider_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_global_photo ON global_riders;
CREATE TRIGGER trg_sync_global_photo
AFTER INSERT OR UPDATE ON global_riders
FOR EACH ROW EXECUTE FUNCTION sync_global_photo_to_riders();
