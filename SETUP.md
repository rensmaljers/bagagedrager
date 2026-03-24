# Bagagedrager Tour - Setup Guide

## 1. Supabase Setup

### Create project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL** and **Anon Key** from Settings → API

### Run migrations
1. Install Supabase CLI: `brew install supabase/tap/supabase`
2. Link: `supabase link --project-ref YOUR_PROJECT_REF`
3. Run migration: `supabase db push`

Or manually: copy `supabase/migrations/001_schema.sql` into the Supabase SQL Editor and run it.

### Deploy Edge Functions
```bash
supabase functions deploy submit-pick
supabase functions deploy admin-results
supabase functions deploy admin-lock-stage
```

### Set an admin user
After signing up, run in SQL Editor:
```sql
UPDATE profiles SET is_admin = true WHERE display_name = 'YourName';
```

### (Optional) Cron to auto-lock stages
In Supabase Dashboard → Database → Extensions, enable `pg_cron`, then:
```sql
SELECT cron.schedule(
  'lock-stages',
  '*/15 * * * *',  -- every 15 minutes
  $$
  UPDATE stages SET locked = true
  WHERE deadline < now() AND locked = false;
  $$
);
```

## 2. Frontend Config

Edit `public/app.js` and replace:
```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

## 3. Netlify Deploy

1. Push this repo to GitHub
2. Connect to Netlify
3. Build settings:
   - **Publish directory:** `public`
   - No build command needed (static files)
4. Deploy!

Or use Netlify CLI:
```bash
npm install -g netlify-cli
netlify deploy --prod --dir=public
```

## 4. Seed Data (optional)

### Add sample riders
```sql
INSERT INTO riders (bib_number, name, team) VALUES
(1, 'Tadej Pogačar', 'UAE Team Emirates'),
(2, 'Jonas Vingegaard', 'Team Visma-Lease a Bike'),
(3, 'Remco Evenepoel', 'Soudal Quick-Step'),
(11, 'Wout van Aert', 'Team Visma-Lease a Bike'),
(12, 'Mathieu van der Poel', 'Alpecin-Deceuninck'),
(21, 'Jasper Philipsen', 'Alpecin-Deceuninck'),
(31, 'Primož Roglič', 'Red Bull-BORA-hansgrohe'),
(41, 'Mads Pedersen', 'Lidl-Trek'),
(51, 'Adam Yates', 'UAE Team Emirates'),
(61, 'Biniam Girmay', 'Intermarché-Wanty');
```

### Add sample stages
```sql
INSERT INTO stages (stage_number, name, date, stage_type, deadline) VALUES
(1, 'Lille → Dunkerque', '2025-07-05', 'flat', '2025-07-04 21:00:00+00'),
(2, 'Dunkerque → Boulogne-sur-Mer', '2025-07-06', 'sprint', '2025-07-05 21:00:00+00'),
(3, 'Valenciennes → Laon', '2025-07-07', 'mountain', '2025-07-06 21:00:00+00');
```

## Architecture

```
public/
  index.html          - Single page app (Bootstrap 5)
  app.js              - All frontend logic (vanilla JS)

supabase/
  migrations/
    001_schema.sql    - Database schema, views, RLS policies
  functions/
    submit-pick/      - Submit/update a rider pick for a stage
    admin-results/    - Admin: enter stage results
    admin-lock-stage/ - Lock stages past deadline (cron-callable)
```

## Key Queries

### General Classification
```sql
SELECT * FROM general_classification ORDER BY total_time ASC;
```

### Points Classification
```sql
SELECT * FROM general_classification ORDER BY total_points DESC;
```

### Mountain Classification
```sql
SELECT * FROM general_classification ORDER BY total_mountain_points DESC;
```

### User's remaining riders
```sql
SELECT r.* FROM riders r
WHERE r.id NOT IN (
  SELECT rider_id FROM picks WHERE user_id = 'USER_UUID'
);
```

### Stage deadline check
```sql
SELECT * FROM stages
WHERE locked = false AND deadline > now()
ORDER BY stage_number
LIMIT 1;
```
