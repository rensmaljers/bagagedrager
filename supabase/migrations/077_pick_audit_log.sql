-- ============================================
-- 077: pick_audit_log — wie wijzigde welke pick, wanneer en via welke route
-- Aanleiding: vraag "heeft Joeri iets gewijzigd?" bleek niet te beantwoorden
-- buiten submitted_at om (geen historie bij overschrijven/intrekken, geen
-- spoor van te-laat-geweigerde pogingen). Deze migratie logt élke insert/
-- update/delete op picks via een trigger, plus welke RPC ('source') de
-- wijziging deed. Alleen admins mogen de log lezen.
-- ============================================

CREATE TABLE pick_audit_log (
  id bigserial PRIMARY KEY,
  pick_id int,
  user_id uuid NOT NULL,
  stage_id int NOT NULL,
  rider_id int,
  old_rider_id int,
  is_late boolean,
  is_random boolean,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  source text NOT NULL DEFAULT 'unknown',
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pick_audit_log_user_time ON pick_audit_log (user_id, changed_at DESC);
CREATE INDEX idx_pick_audit_log_stage ON pick_audit_log (stage_id);

ALTER TABLE pick_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins lezen audit-log" ON pick_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

GRANT SELECT ON pick_audit_log TO authenticated;

-- Geen insert-policy: alleen de trigger (SECURITY DEFINER, tabel-owner)
-- schrijft hier. Geen FK op pick_id — bij een delete bestaat de rij in
-- picks niet meer op het moment dat de audit-rij wordt weggeschreven.

CREATE OR REPLACE FUNCTION log_pick_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO pick_audit_log (pick_id, user_id, stage_id, rider_id, is_late, is_random, action, source, changed_by)
    VALUES (OLD.id, OLD.user_id, OLD.stage_id, OLD.rider_id, OLD.is_late, OLD.is_random,
            'delete', coalesce(current_setting('audit.source', true), 'unknown'), auth.uid());
    RETURN OLD;
  ELSE
    INSERT INTO pick_audit_log (pick_id, user_id, stage_id, rider_id, old_rider_id, is_late, is_random, action, source, changed_by)
    VALUES (NEW.id, NEW.user_id, NEW.stage_id, NEW.rider_id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.rider_id ELSE NULL END,
            NEW.is_late, NEW.is_random,
            CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END,
            coalesce(current_setting('audit.source', true), 'unknown'), auth.uid());
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_pick_audit
AFTER INSERT OR UPDATE OR DELETE ON picks
FOR EACH ROW EXECUTE FUNCTION log_pick_change();

-- ============================================
-- Elke RPC zet audit.source (transactie-lokaal) vóór de write, zodat de
-- trigger weet via welke route de wijziging binnenkwam. Functie-bodies zijn
-- verder ongewijzigd t.o.v. hun laatste versie (053/070/025); SET search_path
-- moet hier herhaald worden — CREATE OR REPLACE reset proconfig anders.
-- ============================================

CREATE OR REPLACE FUNCTION submit_pick(p_stage_id int, p_rider_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_stage record;
  v_comp_id int;
  v_is_late boolean;
  v_already_used boolean;
  v_is_dnf boolean;
  v_existing_pick record;
  v_result record;
BEGIN
  PERFORM set_config('audit.source', 'submit_pick', true);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  SELECT * INTO v_stage FROM stages WHERE id = p_stage_id;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Etappe niet gevonden';
  END IF;

  v_comp_id := v_stage.competition_id;
  v_is_late := (now() > v_stage.deadline) OR v_stage.locked;

  SELECT EXISTS(
    SELECT 1 FROM picks p
    JOIN stages s ON s.id = p.stage_id
    WHERE p.user_id = v_user_id
      AND p.rider_id = p_rider_id
      AND p.stage_id != p_stage_id
      AND s.competition_id = v_comp_id
  ) INTO v_already_used;

  IF v_already_used THEN
    RAISE EXCEPTION 'Je hebt deze renner al gebruikt in een andere etappe';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM riders WHERE id = p_rider_id AND dnf = true
    UNION ALL
    SELECT 1 FROM stage_results sr
    JOIN stages s ON s.id = sr.stage_id
    WHERE sr.rider_id = p_rider_id
      AND sr.dnf = true
      AND s.competition_id = v_comp_id
  ) INTO v_is_dnf;

  IF v_is_dnf THEN
    RAISE EXCEPTION 'Deze renner heeft de koers verlaten (DNF) en kan niet meer gekozen worden';
  END IF;

  SELECT * INTO v_existing_pick FROM picks
  WHERE user_id = v_user_id AND stage_id = p_stage_id;

  IF v_existing_pick IS NOT NULL AND v_is_late THEN
    RAISE EXCEPTION 'Etappe is vergrendeld, keuze kan niet meer gewijzigd worden';
  END IF;

  INSERT INTO picks (user_id, stage_id, rider_id, is_late, submitted_at)
  VALUES (v_user_id, p_stage_id, p_rider_id, v_is_late, now())
  ON CONFLICT (user_id, stage_id)
  DO UPDATE SET rider_id = p_rider_id, is_late = v_is_late, submitted_at = now()
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'success', true,
    'pick_id', v_result.id,
    'is_late', v_is_late,
    'warning', CASE WHEN v_is_late THEN 'Keuze ingediend na deadline — te laat straf geldt' ELSE null END
  );
END;
$$;

CREATE OR REPLACE FUNCTION assign_random_riders(p_stage_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id int;
  v_user record;
  v_rider_id int;
  v_count int := 0;
BEGIN
  PERFORM set_config('audit.source', 'assign_random_riders', true);

  SELECT competition_id INTO v_comp_id FROM stages WHERE id = p_stage_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Stage niet gevonden');
  END IF;

  FOR v_user IN
    SELECT DISTINCT p.user_id
    FROM picks p
    JOIN stages s ON s.id = p.stage_id
    WHERE s.competition_id = v_comp_id
      AND p.user_id NOT IN (
        SELECT user_id FROM picks WHERE stage_id = p_stage_id
      )
  LOOP
    SELECT r.id INTO v_rider_id
    FROM riders r
    WHERE r.competition_id = v_comp_id
      AND r.dnf = false
      AND r.id NOT IN (
        SELECT pk.rider_id FROM picks pk
        JOIN stages st ON st.id = pk.stage_id
        WHERE pk.user_id = v_user.user_id
          AND st.competition_id = v_comp_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM stage_results sr
        JOIN stages s ON s.id = sr.stage_id
        WHERE sr.rider_id = r.id
          AND sr.dnf = true
          AND s.competition_id = v_comp_id
      )
    ORDER BY random()
    LIMIT 1;

    IF v_rider_id IS NOT NULL THEN
      INSERT INTO picks (user_id, stage_id, rider_id, is_late, is_random)
      VALUES (v_user.user_id, p_stage_id, v_rider_id, false, true);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION withdraw_pick(p_stage_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_stage record;
  v_deleted int;
BEGIN
  PERFORM set_config('audit.source', 'withdraw_pick', true);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  SELECT * INTO v_stage FROM stages WHERE id = p_stage_id;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Etappe niet gevonden';
  END IF;

  IF (now() > v_stage.deadline) OR v_stage.locked THEN
    RAISE EXCEPTION 'Deadline verstreken — keuze kan niet meer worden verwijderd';
  END IF;

  DELETE FROM picks
  WHERE user_id = v_user_id AND stage_id = p_stage_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'Geen keuze gevonden voor deze etappe';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_upsert_pick(
  p_user_id uuid,
  p_stage_id int,
  p_rider_id int,
  p_is_late boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_competition_id int;
  v_used_elsewhere int;
BEGIN
  PERFORM set_config('audit.source', 'admin_upsert_pick', true);

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  SELECT s.competition_id INTO v_competition_id FROM stages s WHERE s.id = p_stage_id;
  IF v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Etappe bestaat niet';
  END IF;

  SELECT COUNT(*) INTO v_used_elsewhere
  FROM picks p
  JOIN stages s ON s.id = p.stage_id
  WHERE p.user_id = p_user_id
    AND s.competition_id = v_competition_id
    AND p.rider_id = p_rider_id
    AND p.stage_id <> p_stage_id;

  IF v_used_elsewhere > 0 THEN
    RAISE EXCEPTION 'Deze renner is al gebruikt door deze speler in een andere etappe';
  END IF;

  INSERT INTO picks (user_id, stage_id, rider_id, is_late, is_random)
  VALUES (p_user_id, p_stage_id, p_rider_id, coalesce(p_is_late, false), false)
  ON CONFLICT (user_id, stage_id)
  DO UPDATE SET
    rider_id = excluded.rider_id,
    is_late = excluded.is_late,
    is_random = false;

  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_pick(
  p_user_id uuid,
  p_stage_id int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  PERFORM set_config('audit.source', 'admin_delete_pick', true);

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  DELETE FROM picks WHERE user_id = p_user_id AND stage_id = p_stage_id;

  PERFORM calculate_game_points(p_stage_id);

  RETURN jsonb_build_object('success', true);
END;
$$;
