-- Extra renner-informatie van PCS
ALTER TABLE riders ADD COLUMN IF NOT EXISTS nationality text;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS weight_kg numeric;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS height_m numeric;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS specialty_one_day int;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS specialty_gc int;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS specialty_tt int;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS specialty_sprint int;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS specialty_climber int;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS specialty_hills int;
