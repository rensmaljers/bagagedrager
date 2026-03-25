-- PCS URL opslaan per competitie voor directe sync
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS pcs_url text;

-- Fix: riders.competition_id cascade was niet correct aangemaakt
ALTER TABLE riders DROP CONSTRAINT IF EXISTS riders_competition_id_fkey;
ALTER TABLE riders ADD CONSTRAINT riders_competition_id_fkey
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;

-- Spelers deactiveren: is_active kolom op profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Admin functie: speler verwijderen (verwijdert profile + picks, auth user blijft bestaan)
CREATE OR REPLACE FUNCTION admin_delete_player(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin boolean;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT coalesce(v_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;
  -- Verwijder picks
  DELETE FROM picks WHERE user_id = p_user_id;
  -- Verwijder profiel
  DELETE FROM profiles WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Ronde-styling: kleur en landvlag per ronde
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS color text DEFAULT '#facc15';
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS country_flag text DEFAULT '';

-- Performance: composite indexes voor veelgebruikte queries
CREATE INDEX IF NOT EXISTS idx_stage_results_stage_rider ON stage_results(stage_id, rider_id);
CREATE INDEX IF NOT EXISTS idx_picks_stage_rider ON picks(stage_id, rider_id);
CREATE INDEX IF NOT EXISTS idx_stages_locked_deadline ON stages(locked, deadline);
