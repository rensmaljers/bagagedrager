-- Opt-in emailherinneringen per speler
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_reminders boolean NOT NULL DEFAULT false;
