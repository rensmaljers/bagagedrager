-- ============================================
-- Expliciete inschrijving per ronde ("Ik doe mee")
-- ============================================
-- Aanleiding: deelname was impliciet (eerste pick = meedoen). Wie pas bij
-- etappe 15 instapte miste 14 etappes aan tijdverschil en stond direct bovenaan
-- het AK (general_classification telt alleen etappes mét pick). Bovendien kreeg
-- wie etappe 1 vergat géén Rad-renner, want het Rad kende alleen spelers met ≥1 pick.
--
-- Nieuw:
--   * Deelnemer = rij in competition_participants (bestond al voor de pot).
--   * join_competition / leave_competition: alleen vóór de start van de ronde
--     (= eerste etappe locked of deadline verstreken).
--   * submit_pick weigert niet-deelnemers.
--   * assign_random_riders loopt over alle deelnemers i.p.v. "iedereen met een pick"
--     → wie etappe 1 vergeet krijgt een Rad-renner.
--   * admin_add_participant: admin kan iemand ná de start toevoegen; voor al
--     gestarte etappes krijgt die speler een te-late Rad-pick (straftijd + 0 punten),
--     zodat een late instapper geen AK-voordeel heeft.
--   * Backfill: iedereen met picks in een ronde wordt deelnemer.
--   * DNS: wie drie gestarte etappes op rij een Rad-renner kreeg (geen eigen
--     keuze) is definitief uit de koers voor die ronde (dns_at). Het Rad slaat
--     hem daarna over, submit_pick weigert hem en de frontend zet hem onderaan
--     elk klassement met "DNS" en buiten de prijzen. Te-late Rad-picks van een
--     door de admin toegevoegde laatkomer (is_late) tellen niet mee.
--     competition_pot_status krijgt de kolom is_dns.
--
-- Leidend na deze migratie: submit_pick + assign_random_riders (was 077).
-- Bestandsnaam met tijdstempel i.p.v. 087: er staat al een tijdstempel-migratie
-- (20260829070425) live; een 087 zou daarvóór sorteren en db push laten weigeren.

ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dns_at timestamptz,
  ADD COLUMN IF NOT EXISTS dns_stage_id int REFERENCES stages(id) ON DELETE SET NULL;

-- Pot-view (leidend was 074) + publieke DNS-status. Nieuwe kolom achteraan,
-- dus CREATE OR REPLACE mag; paid_at/dns_at blijven privé.
CREATE OR REPLACE VIEW competition_pot_status AS
  SELECT competition_id, user_id, has_paid, (dns_at IS NOT NULL) AS is_dns
  FROM competition_participants;
GRANT SELECT ON competition_pot_status TO authenticated, anon;

-- Backfill: wie al picks heeft in een ronde doet mee (bestaande rijen blijven)
INSERT INTO competition_participants (competition_id, user_id, joined_at)
SELECT s.competition_id, p.user_id, COALESCE(MIN(p.submitted_at), now())
FROM picks p
JOIN stages s ON s.id = p.stage_id
GROUP BY s.competition_id, p.user_id
ON CONFLICT (competition_id, user_id) DO NOTHING;

-- Is de ronde begonnen? (eerste etappe gestart/vergrendeld)
CREATE OR REPLACE FUNCTION competition_started(p_competition_id int)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM stages
    WHERE competition_id = p_competition_id
      AND (locked OR deadline <= now())
  );
$$;

-- --------------------------------------------
-- join_competition: speler schrijft zich in
-- --------------------------------------------
CREATE OR REPLACE FUNCTION join_competition(p_competition_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM competitions WHERE id = p_competition_id AND is_active) THEN
    RAISE EXCEPTION 'Ronde niet gevonden of niet actief';
  END IF;

  IF EXISTS (SELECT 1 FROM competition_participants
             WHERE competition_id = p_competition_id AND user_id = v_user_id) THEN
    RETURN jsonb_build_object('success', true, 'already', true);
  END IF;

  IF competition_started(p_competition_id) THEN
    RAISE EXCEPTION 'De ronde is al begonnen — inschrijven kan niet meer';
  END IF;

  INSERT INTO competition_participants (competition_id, user_id)
  VALUES (p_competition_id, v_user_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- --------------------------------------------
-- leave_competition: uitschrijven tot de start
-- --------------------------------------------
CREATE OR REPLACE FUNCTION leave_competition(p_competition_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  PERFORM set_config('audit.source', 'leave_competition', true);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  IF competition_started(p_competition_id) THEN
    RAISE EXCEPTION 'De ronde is al begonnen — uitschrijven kan niet meer';
  END IF;

  IF EXISTS (SELECT 1 FROM competition_participants
             WHERE competition_id = p_competition_id AND user_id = v_user_id AND has_paid) THEN
    RAISE EXCEPTION 'Je inleg is al betaald — vraag de admin om je uit te schrijven';
  END IF;

  -- Vóór de start bestaan alleen nog niet-vergrendelde picks: die vervallen
  DELETE FROM picks p
  USING stages s
  WHERE s.id = p.stage_id
    AND s.competition_id = p_competition_id
    AND p.user_id = v_user_id;

  DELETE FROM competition_participants
  WHERE competition_id = p_competition_id AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- --------------------------------------------
-- admin_add_participant: ook ná de start, met te-late Rad-picks voor
-- de al gestarte etappes (straftijd + 0 punten, telt niet mee in de
-- strafpool of deelpenalty — is_random).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION admin_add_participant(p_competition_id int, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_stage record;
  v_rider_id int;
  v_count int := 0;
BEGIN
  PERFORM set_config('audit.source', 'admin_add_participant', true);

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = auth.uid();
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin rechten vereist';
  END IF;

  INSERT INTO competition_participants (competition_id, user_id)
  VALUES (p_competition_id, p_user_id)
  ON CONFLICT (competition_id, user_id) DO NOTHING;

  FOR v_stage IN
    SELECT id FROM stages
    WHERE competition_id = p_competition_id
      AND (locked OR deadline <= now())
      AND NOT EXISTS (SELECT 1 FROM picks WHERE stage_id = stages.id AND user_id = p_user_id)
    ORDER BY stage_number
  LOOP
    SELECT r.id INTO v_rider_id
    FROM riders r
    WHERE r.competition_id = p_competition_id
      AND r.dnf = false
      AND r.id NOT IN (
        SELECT pk.rider_id FROM picks pk
        JOIN stages st ON st.id = pk.stage_id
        WHERE pk.user_id = p_user_id AND st.competition_id = p_competition_id
      )
    ORDER BY random()
    LIMIT 1;

    IF v_rider_id IS NOT NULL THEN
      INSERT INTO picks (user_id, stage_id, rider_id, is_late, is_random)
      VALUES (p_user_id, v_stage.id, v_rider_id, true, true);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'late_picks', v_count);
END;
$$;

-- --------------------------------------------
-- submit_pick (leidend was 077) — + deelnamecheck
-- --------------------------------------------
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

  IF NOT EXISTS (SELECT 1 FROM competition_participants
                 WHERE competition_id = v_comp_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Je doet niet mee aan deze ronde — schrijf je in vóór de start';
  END IF;

  IF EXISTS (SELECT 1 FROM competition_participants
             WHERE competition_id = v_comp_id AND user_id = v_user_id AND dns_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Je bent uit de koers (DNS): drie etappes op rij geen keuze';
  END IF;

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

-- --------------------------------------------
-- check_dns: na een Rad-toewijzing kijken of de speler de laatste drie
-- gestarte etappes (t/m p_stage_id) allemaal een Rad-renner kreeg.
-- Te-late Rad-picks (laatkomer via admin) tellen niet mee.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION check_dns(p_stage_id int, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage record;
  v_total int;
  v_rad int;
BEGIN
  SELECT competition_id, stage_number INTO v_stage FROM stages WHERE id = p_stage_id;
  IF v_stage IS NULL THEN RETURN false; END IF;

  WITH last3 AS (
    SELECT s.id
    FROM stages s
    WHERE s.competition_id = v_stage.competition_id
      AND s.stage_number <= v_stage.stage_number
      AND (s.locked OR s.deadline <= now() OR s.id = p_stage_id)
    ORDER BY s.stage_number DESC
    LIMIT 3
  )
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE p.is_random AND NOT p.is_late)
  INTO v_total, v_rad
  FROM last3 l
  LEFT JOIN picks p ON p.stage_id = l.id AND p.user_id = p_user_id;

  IF v_total = 3 AND v_rad = 3 THEN
    UPDATE competition_participants
    SET dns_at = now(), dns_stage_id = p_stage_id
    WHERE competition_id = v_stage.competition_id
      AND user_id = p_user_id
      AND dns_at IS NULL;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- --------------------------------------------
-- assign_random_riders (leidend was 077) — loopt nu over deelnemers,
-- slaat DNS-spelers over en zet na drie Rad-picks op rij DNS
-- --------------------------------------------
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
  v_dns int := 0;
BEGIN
  PERFORM set_config('audit.source', 'assign_random_riders', true);

  SELECT competition_id INTO v_comp_id FROM stages WHERE id = p_stage_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Stage niet gevonden');
  END IF;

  FOR v_user IN
    SELECT cp.user_id
    FROM competition_participants cp
    WHERE cp.competition_id = v_comp_id
      AND cp.dns_at IS NULL
      AND cp.user_id NOT IN (
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
      IF check_dns(p_stage_id, v_user.user_id) THEN
        v_dns := v_dns + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_count, 'dns', v_dns);
END;
$$;

-- --------------------------------------------
-- EXECUTE-hygiëne (patroon 081/082/086)
-- --------------------------------------------
REVOKE EXECUTE ON FUNCTION assign_random_riders(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assign_random_riders(int) TO service_role;
-- Interne helper: alleen vanuit assign_random_riders (draait als owner)
REVOKE EXECUTE ON FUNCTION check_dns(int, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_dns(int, uuid) TO service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'submit_pick(integer, integer)',
    'join_competition(integer)',
    'leave_competition(integer)',
    'admin_add_participant(integer, uuid)',
    'competition_started(integer)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
