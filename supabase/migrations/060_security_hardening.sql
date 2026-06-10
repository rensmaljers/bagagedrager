-- ============================================
-- 060: Security hardening
-- ============================================
-- 1. search_path vastzetten op alle SECURITY DEFINER functies
--    (voorkomt schema-hijacking; standaard Supabase-linter-aanbeveling).
--    Functies die auth.users gebruiken doen dat met expliciete schema-prefix,
--    dus search_path=public volstaat.
-- 2. Cron-jobs voor auto-rad/auto-sync/auto-remind sturen voortaan het
--    x-cron-secret mee (zelfde mechaniek als weekly-rider-specialty-refresh,
--    zie 042). De edge functions controleren dit secret.

-- --- 1. search_path ---
ALTER FUNCTION admin_confirm_email(uuid)                       SET search_path = public;
ALTER FUNCTION admin_delete_pick(uuid, integer)                SET search_path = public;
ALTER FUNCTION admin_delete_player(uuid)                       SET search_path = public;
ALTER FUNCTION admin_save_results(integer, jsonb, boolean)     SET search_path = public;
ALTER FUNCTION admin_upsert_pick(uuid, integer, integer, boolean) SET search_path = public;
ALTER FUNCTION admin_users_with_status()                       SET search_path = public;
ALTER FUNCTION assign_random_riders(integer)                   SET search_path = public;
ALTER FUNCTION calculate_game_points(integer)                  SET search_path = public;
ALTER FUNCTION delete_own_account()                            SET search_path = public;
ALTER FUNCTION get_cron_secret()                               SET search_path = public;
ALTER FUNCTION submit_pick(integer, integer)                   SET search_path = public;

-- --- 2. cron-jobs met x-cron-secret ---
SELECT cron.unschedule('auto-rad') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-rad');
SELECT cron.schedule(
  'auto-rad',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-rad',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.unschedule('auto-remind') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-remind');
SELECT cron.schedule(
  'auto-remind',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.unschedule('auto-sync-ochtend') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-sync-ochtend');
SELECT cron.schedule(
  'auto-sync-ochtend',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.unschedule('auto-sync-middag') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-sync-middag');
SELECT cron.schedule(
  'auto-sync-middag',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM _app_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);
