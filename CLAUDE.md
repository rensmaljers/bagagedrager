# Bagagedrager — Het Wielerspel

## Project overview
Fantasy cycling game ("wielerspel") where players pick one rider per stage and compete across four classifications. Built as a single-page app with Supabase backend.

## Tech stack
- **Frontend**: Vanilla JS + HTML/CSS (`public/index.html`, `public/app.js`, `public/style.css`), Bootstrap 5 for grid/components
- **Backend**: Supabase (PostgreSQL + Edge Functions + Auth + RLS)
- **Hosting**: Netlify — builds via `npm run build` (Vite), deploys from `dist/`
- **Data source**: ProCyclingStats (PCS) scraping for race results

## Architecture
- Vite build step: source in `public/`, output in `dist/` (gitignored)
- All business logic lives in PostgreSQL functions and views (`supabase/migrations/`)
- Edge Functions in `supabase/functions/` handle PCS scraping and admin operations
- Frontend communicates via Supabase REST API (PostgREST)
- Git workflow: commit and push directly to `main`, no feature branches or PRs

## Key files
- `public/index.html` — Full app UI (HTML + inline CSS + auth/theme scripts)
- `public/app.js` — All app logic (data loading, rendering, admin panel)
- `supabase/migrations/` — Database schema, views, functions (numbered sequentially)
- `supabase/functions/sync-pcs-results/` — PCS result scraper edge function

## Scoring system (4 classifications)
1. **Algemeen Klassement (GC)** — Sum of time gaps to stage winner, minus `bonification_seconds` from `stage_results`. DNF/late = worst time gap of any picked rider who finished that stage. No sharing penalty.
2. **Puntenklassement (Points)** — Sum of sprint points from PCS Points Classification. No sharing penalty.
3. **Bergklassement (Mountain)** — Sum of KOM points from PCS Mountain/KOM Classification. No sharing penalty.
4. **Spelklassement (Game)** — Points based on finish position (1st=100, 2nd=80, ..., 20th=5) with sharing multiplier penalty when multiple players pick the same rider.

## Game rules
- Pick 1 rider per stage before the start time (deadline = start_time)
- Each rider can only be used once per competition
- Late/no pick → "Rad van Fortuin" assigns a random unused rider; GC penalty = worst time of picked riders
- DNF/DNS/OTL = same GC penalty as late; 0 points in all other classifications
- Bonification seconds stored per rider in `stage_results.bonification_seconds` (scraped from PCS or entered manually by admin). NOT derived from finish position.

## Conventions
- Language: Dutch (UI text, comments, migration comments)
- CSS: Custom properties for theming (dark/light mode), `--comp-color` for competition accent color
- Tooltips: Use `data-tip` attribute on `.info-tooltip` spans (JS-powered fixed positioning)
- Team badges: `teamBadge()` function with shirt images from localStorage + fallback color dots
- Migrations: Numbered sequentially (001_, 002_, ...), each is idempotent where possible

## PCS scraping
The edge function `sync-pcs-results` fetches PCS stage pages and parses HTML:
- PCS uses a **tabbed interface** (`ul.restabs` / `ul.resultTabs`) with tabs: Stage, GC, Points, KOM, BONIS
- Each tab has `data-id` linking to `div.resTab[data-id="..."]` containing a `table.results`
- Points classification data comes from the "POINTS" tab, mountain from "KOM" tab
- **Bonification**: in `td.ar.cu600` within each result row, uses `″` (U+2033 double prime) for seconds. Multiple values (e.g. `2″-20″`) are summed.
- **DNF/DNS/OTL/DSQ**: detected by checking ALL cells in a row for these keywords (not just the time cell)
- Manual DNF overrides are preserved on re-sync (migration 029): if `dnf=true` in DB and PCS returns `dnf=false`, the DB value wins

## Common commands
```bash
# Start Supabase locally
supabase start

# Deploy edge functions
supabase functions deploy sync-pcs-results

# Apply migrations
supabase db push
```
