-- Laatste login bijhouden in profiles (zichtbaar voor alle spelers)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Voeg last_sign_in_at en last_seen_at toe aan admin_users_with_status
DROP FUNCTION IF EXISTS admin_users_with_status();
CREATE OR REPLACE FUNCTION admin_users_with_status()
RETURNS TABLE(
  id uuid,
  display_name text,
  email text,
  is_admin boolean,
  is_active boolean,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at timestamptz
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
    u.email_confirmed_at,
    u.last_sign_in_at,
    p.last_seen_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at;
END;
$$;
