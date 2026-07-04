-- ============================================
-- 071: delete_own_account repareren
-- De RPC uit 048 verwijderde alleen auth.users, maar picks, profiles en
-- push_subscriptions verwijzen daarnaar zonder ON DELETE CASCADE → 23503
-- (foreign key violation) voor iedere gebruiker met een profiel.
-- Gevonden 4 juli 2026 bij het opruimen van een signup-testaccount.
-- Volgorde: kindtabellen eerst; competition_participants cascadet al via profiles.
-- ============================================

CREATE OR REPLACE FUNCTION delete_own_account()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;

  DELETE FROM picks              WHERE user_id = v_uid;
  DELETE FROM push_subscriptions WHERE user_id = v_uid;
  DELETE FROM profiles           WHERE id = v_uid; -- cascade: competition_participants
  DELETE FROM auth.users         WHERE id = v_uid;
END;
$$;
