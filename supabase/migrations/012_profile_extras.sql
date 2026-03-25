-- ============================================
-- ACCOUNT: Extra profielvelden + avatar
-- ============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS favorite_team text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cycling_hero text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS motto text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Storage bucket voor profielfoto's
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Iedereen mag avatars lezen
CREATE POLICY "Public read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Users mogen hun eigen avatar uploaden/updaten/verwijderen
CREATE POLICY "Users manage own avatar" ON storage.objects
  FOR ALL USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
