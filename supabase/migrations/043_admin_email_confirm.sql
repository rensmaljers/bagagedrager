-- Admin functie: geeft alle profielen terug met email bevestigingsstatus
CREATE OR REPLACE FUNCTION admin_users_with_status()
RETURNS TABLE(
  id uuid,
  display_name text,
  email text,
  is_admin boolean,
  is_active boolean,
  created_at timestamptz,
  email_confirmed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    p.email,
    p.is_admin,
    p.is_active,
    p.created_at,
    u.email_confirmed_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at;
END;
$$;

-- Admin functie: bevestig e-mailadres handmatig
CREATE OR REPLACE FUNCTION admin_confirm_email(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = now()
  WHERE id = target_user_id AND email_confirmed_at IS NULL;
END;
$$;
