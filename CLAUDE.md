# Bagagedrager — Het Wielerspel

## Project overview
Fantasy cycling game ("wielerspel") where players pick one rider per stage and compete across four classifications. Built as a single-page app with Supabase backend.

## Tech stack
- **Frontend**: Vanilla JS + HTML/CSS (single `public/index.html` + `public/app.js`), Bootstrap 5 for grid/components
- **Backend**: Supabase (PostgreSQL + Edge Functions + Auth + RLS)
- **Hosting**: Netlify (static site from `public/`)
- **Data source**: ProCyclingStats (PCS) scraping for race results

## Architecture
- No build step — everything is plain JS/HTML/CSS served from `public/`
- All business logic lives in PostgreSQL functions and views (`supabase/migrations/`)
- Edge Functions in `supabase/functions/` handle PCS scraping and admin operations
- Frontend communicates via Supabase REST API (PostgREST)

## Key files
- `public/index.html` — Full app UI (HTML + inline CSS + auth/theme scripts)
- `public/app.js` — All app logic (data loading, rendering, admin panel)
- `supabase/migrations/` — Database schema, views, functions (numbered sequentially)
- `supabase/functions/sync-pcs-results/` — PCS result scraper edge function

## Scoring system (4 classifications)
1. **Algemeen Klassement (GC)** — Sum of time gaps to stage winner per stage, minus bonification seconds (1st: -10s, 2nd: -6s, 3rd: -4s). Late/DNF = worst time.
2. **Puntenklassement (Points)** — Sum of sprint points from PCS Points Classification table per stage.
3. **Bergklassement (Mountain)** — Sum of KOM points from PCS Mountain/KOM Classification table per stage.
4. **Spelklassement (Game)** — Points based on finish position (1st=100, 2nd=80, ..., 20th=5) with sharing multiplier penalty when multiple players pick the same rider.

## Game rules
- Pick 1 rider per stage before the start time (deadline = start_time)
- Each rider can only be used once per competition
- Late pick = worst time + 0 points
- No pick = "Rad van Fortuin" assigns a random unused rider
- DNF = same penalty as late

## Conventions
- Language: Dutch (UI text, comments, migration comments)
- CSS: Custom properties for theming (dark/light mode), `--comp-color` for competition accent color
- Tooltips: Use `data-tip` attribute on `.info-tooltip` spans (JS-powered fixed positioning)
- Team badges: `teamBadge()` function with shirt images from localStorage + fallback color dots
- Migrations: Numbered sequentially (001_, 002_, ...), each is idempotent where possible

## PCS scraping
The edge function `sync-pcs-results` fetches PCS stage pages and parses HTML:
- PCS uses a **tabbed interface** (`ul.restabs` / `ul.resultTabs`) with tabs: Stage, GC, Points, KOM
- Each tab has `data-id` linking to `div.resTab[data-id="..."]` containing a `table.results`
- Points classification data comes from the "POINTS" tab, mountain from "KOM" tab
- Main results table provides time and bib number only

## Common commands
```bash
# Start Supabase locally
supabase start

# Deploy edge functions
supabase functions deploy sync-pcs-results

# Apply migrations
supabase db push
```
