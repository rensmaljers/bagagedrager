-- ============================================
-- 070: withdraw_pick — speler trekt eigen keuze in vóór de deadline
-- picks heeft bewust geen delete-policy; net als submit_pick loopt dit via
-- een SECURITY DEFINER RPC zodat alle regels op één plek staan.
-- ============================================

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

GRANT EXECUTE ON FUNCTION withdraw_pick(int) TO authenticated;
