-- ============================================
-- 076: Uitnodigingslinks — herbruikbare invite-codes per ronde
--
-- Onboarding: admin genereert een link (?invite=<code>), deelt die in de
-- groepsapp. De pre-auth landing (Auth-scherm) toont dan een gebrande welkom
-- ("Je bent uitgenodigd voor Tour de France 2026") en zet signup als default.
-- Signup zelf is al open (cap 200, ruim), dus de code is puur context/attributie
-- — geen toegangspoort. resolve_invite is anon-aanroepbaar en geeft alléén
-- niet-gevoelige velden terug.
-- ============================================

CREATE TABLE IF NOT EXISTS invite_codes (
  code           text PRIMARY KEY,
  competition_id int  REFERENCES competitions(id) ON DELETE CASCADE,
  label          text,
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  active         boolean NOT NULL DEFAULT true,
  uses           int NOT NULL DEFAULT 0
);

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- Alleen admins beheren de tabel direct (lezen/aanmaken/deactiveren in het admin-panel)
CREATE POLICY "invite_admin_all" ON invite_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin maakt een code aan; genereert een korte URL-veilige code
CREATE OR REPLACE FUNCTION create_invite(p_competition_id int, p_label text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Alleen admins kunnen uitnodigingen aanmaken';
  END IF;
  -- 8 tekens uit een md5, botsingskans verwaarloosbaar op deze schaal
  LOOP
    v_code := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM invite_codes WHERE code = v_code);
  END LOOP;
  INSERT INTO invite_codes (code, competition_id, label, created_by)
  VALUES (v_code, p_competition_id, p_label, auth.uid());
  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION create_invite(int, text) TO authenticated;

-- Pre-auth: resolve een code naar veilige weergave-velden (anon mag dit).
-- Geeft niets terug bij onbekende/inactieve code.
CREATE OR REPLACE FUNCTION resolve_invite(p_code text)
RETURNS TABLE (competition_id int, competition_name text, inviter_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.competition_id, c.name, p.display_name
  FROM invite_codes i
  LEFT JOIN competitions c ON c.id = i.competition_id
  LEFT JOIN profiles p ON p.id = i.created_by
  WHERE i.code = p_code AND i.active;
$$;
GRANT EXECUTE ON FUNCTION resolve_invite(text) TO anon, authenticated;

-- Telt een succesvolle aanmelding via de code (best-effort attributie).
CREATE OR REPLACE FUNCTION redeem_invite(p_code text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE invite_codes SET uses = uses + 1 WHERE code = p_code AND active;
$$;
GRANT EXECUTE ON FUNCTION redeem_invite(text) TO anon, authenticated;
