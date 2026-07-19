-- 084: feedback / vragen van spelers
--
-- Spelers kunnen via een formuliertje onderaan de app feedback of een vraag
-- insturen; admins lezen alles terug in de Admin-tab. Zelfde security-model als
-- picks: geen directe INSERT-policy, schrijven uitsluitend via een SECURITY
-- DEFINER RPC die auth.uid() afdwingt. Lezen/beheren alleen door admins.

CREATE TABLE feedback (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,  -- profiles i.p.v. auth.users → PostgREST-embed van display_name
  message    text NOT NULL,
  context    text,                                             -- optioneel: welk tabblad/ronde
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved   boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_feedback_created ON feedback (created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Alleen admins lezen/beheren. GEEN insert-policy: schrijven kan enkel via de RPC.
CREATE POLICY "feedback admin select" ON feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin));
CREATE POLICY "feedback admin update" ON feedback FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin));
CREATE POLICY "feedback admin delete" ON feedback FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin));

-- Schrijfpad: dwingt auth.uid() af, valideert en begrenst de lengte.
CREATE OR REPLACE FUNCTION submit_feedback(p_message text, p_context text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd';
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) = 0 THEN
    RAISE EXCEPTION 'Bericht is leeg';
  END IF;
  INSERT INTO feedback (user_id, message, context)
  VALUES (auth.uid(), left(btrim(p_message), 2000), left(p_context, 200));
END;
$$;

-- Grants expliciet (Supabase: REVOKE FROM PUBLIC alleen is niet genoeg — les mig 082).
REVOKE ALL     ON feedback FROM anon;
GRANT  SELECT, UPDATE, DELETE ON feedback TO authenticated;   -- RLS beperkt tot admins
REVOKE EXECUTE ON FUNCTION submit_feedback(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION submit_feedback(text, text) TO authenticated;
