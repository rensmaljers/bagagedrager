-- Speler kan eigen account verwijderen
-- SECURITY DEFINER zodat auth.users kan worden aangepast zonder admin-rechten

CREATE OR REPLACE FUNCTION delete_own_account()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
