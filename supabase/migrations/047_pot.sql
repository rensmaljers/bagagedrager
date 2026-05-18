-- Inlegpot per ronde

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS entry_fee int DEFAULT NULL;

CREATE TABLE IF NOT EXISTS competition_participants (
  competition_id int  NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
  has_paid       boolean     NOT NULL DEFAULT false,
  paid_at        timestamptz,
  PRIMARY KEY (competition_id, user_id)
);

ALTER TABLE competition_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp_select" ON competition_participants
  FOR SELECT USING (true);

CREATE POLICY "cp_admin_all" ON competition_participants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
