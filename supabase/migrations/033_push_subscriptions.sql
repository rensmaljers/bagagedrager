-- ============================================
-- FIX 033: Push subscriptions voor browser notificaties
-- ============================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eigen subscriptions beheren"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- reminder_sent vlag op stages: voorkomt dubbele notificaties
ALTER TABLE stages ADD COLUMN IF NOT EXISTS reminder_sent boolean NOT NULL DEFAULT false;
