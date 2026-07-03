# Bagagedrager — Het Wielerspel

## Project overview
Fantasy cycling game ("wielerspel") where players pick one rider per stage and compete across four classifications. Built as a single-page app with Supabase backend.

- **Live**: https://bagagedrager.netlify.app (geen eigen domein; e-mail staat daarom uit, zie Notificaties)
- **Supabase project-ref**: `hdkvirtytljnuawcmoui`

## Tech stack
- **Frontend**: Vanilla TypeScript + HTML/CSS (`public/`), Bootstrap 5 (CDN, async geladen), Vite build
- **Backend**: Supabase (PostgreSQL + Edge Functions + Auth + RLS + pg_cron)
- **Hosting**: Netlify — auto-deploy bij push naar `main`, build `npm run build`, publish `dist/`
- **Data source**: ProCyclingStats (PCS) scraping for race results

## Architecture
- All business logic lives in PostgreSQL functions and views (`supabase/migrations/`)
- Edge Functions in `supabase/functions/` handle PCS scraping, cron-taken en admin operations
- Frontend communicates via Supabase REST API (PostgREST) + één realtime channel
- Git workflow: commit and push directly to `main`, no feature branches or PRs

## Key files
- `public/index.html` — Full app UI (HTML + inline kritieke CSS + theme script). Bootstrap/Fontshare CSS async (media-swap) — first paint hangt alleen op inline CSS
- `public/app.ts` — Entry: boot (getSession → initApp), tab-navigatie, auth-handlers, account, realtime
- `public/state.ts` — Gedeeld mutable state-object (session, riders, stages, caches). Alle modules muteren `state.x`
- `public/api.ts` — REST-helpers (supaRest/supaDelete/supaPatch/supaUpsert/supaRpc)
- `public/helpers.ts` — UI-helpers (teamBadge, comp-banner, buildPcsStageUrl)
- `public/views/` — Tabbladen: dashboard (klassementen+H2H+badges), pick, history, peloton
- `public/admin.ts` — Admin-panel incl. PCS-sync en imports. **Lazy geladen** (dynamic import bij tab-open)
- `public/notifications.ts` — Deadline- en push-notificaties
- `supabase/functions/_shared/` — `pcs-parse.ts` en `webpush.ts` (getest), `email-template.ts`
- `supabase/functions/tests/` — Deno-tests (PCS-parsing incl. TTT, web push incl. RFC 8291-vector)

### Valkuilen frontend
- **Niets opstart-kritieks in `admin.ts`** — die module laadt pas bij het openen van het admin-tabblad. Boot-code hoort in `app.ts`.
- Inline `onclick="..."` strings in HTML-templates vereisen `window.x = ...`-registratie in de module die de HTML rendert.
- `npm run typecheck` heeft een baseline van ~56 bestaande errors (niet afgedwongen) — niet laten groeien.

## Scoring system (4 classifications)
1. **Algemeen Klassement (GC)** — Sum of time gaps to stage winner, minus `bonification_seconds` from `stage_results`. DNF/DNS/late = slechtste tijdverschil van het **hele veld** op die etappe (de hekkensluiter, migratie 063). No sharing penalty.
2. **Puntenklassement (Points)** — Sum of sprint points from PCS Points Classification. No sharing penalty.
3. **Bergklassement (Mountain)** — Sum of KOM points from PCS Mountain/KOM Classification. No sharing penalty.
4. **Spelklassement (Game)** — Points based on finish position (1st=100, 2nd=80, ..., 20th=5) with sharing multiplier penalty when multiple players pick the same rider.

De klassementen zitten in de views `general_classification` en `stage_picks_public` (beide laatst volledig gedefinieerd in migratie 063). Views draaien als owner en omzeilen RLS — bewust, zodat klassementen compleet blijven.

## Game rules
- Pick 1 rider per stage before the start time (deadline = start_time)
- Each rider can only be used once per competition
- Late/no pick → "Rad van Fortuin" assigns a random unused rider; GC penalty = slechtste tijdverschil van het hele veld (migratie 063)
- DNF/DNS/OTL = same GC penalty as late; 0 points in all other classifications
- Bonification seconds stored per rider in `stage_results.bonification_seconds` (scraped from PCS or entered manually by admin). NOT derived from finish position.
- Klassiekers: één competitie met meerdere "etappes" (koersen) en per-etappe startlijsten in `stage_riders`

## RLS (sinds migratie 058)
- `picks`: eigen picks altijd leesbaar; van anderen pas na deadline/lock; admins alles
- `profiles`: publiek leesbaar; eigen profiel + admin schrijfbaar
- Realtime respecteert RLS — events voor verborgen rijen komen niet binnen

## Cron & edge functions
Cron-jobs (pg_cron + pg_net, zie `cron.job`):
- `auto-rad` (*/10 min) — Rad van Fortuin na deadline (`rad_assigned`-vlag voorkomt dubbel draaien)
- `auto-lock-stages` (*/10 min) — pure SQL UPDATE, geen edge function
- `auto-remind` (*/30 min) — push naar spelers zonder pick, 30–90 min voor deadline (`reminder_sent`-vlag)
- `auto-sync-ochtend/-middag` (9:00/16:00 UTC) — PCS-resultaten syncen
- `weekly-rider-specialty-refresh` (ma 3:00 UTC)

Conventies:
- **Cron-functies** eisen `x-cron-secret`-header; secret staat in `_app_config` (DB), op te vragen via `get_cron_secret()` RPC. Cron-jobs sturen hem mee.
- **Browser-aangeroepen functies** (sync-pcs-*, test-push, test-email) hebben CORS-headers + OPTIONS-handler nodig én `verify_jwt = false` (in `supabase/config.toml` + deploy met `--no-verify-jwt`), want de preflight kan geen JWT dragen. Auth gebeurt ín de functie (sessie + `profiles.is_admin`).
- **Deno crypto-valkuil**: VAPID private key importeren als JWK (d + x/y uit de public key) — minimale PKCS8 importeert wel maar `sign()` faalt met `InvalidEncoding` in de Supabase-runtime.
- Gedeelde code in `_shared/`; importeer nooit uit een andere functie-map (top-level `Deno.serve` van die functie kaapt dan alle requests).
- SECURITY DEFINER functies krijgen `SET search_path = public` (migratie 060).

## Notificaties
- **Push**: werkt volledig (VAPID-keys: public hardcoded, private als secret). iOS alleen als geïnstalleerde PWA.
- **E-mail**: uitgeschakeld (migratie 056) — geen eigen domein, dus Resend heeft geen geldige afzender. Her-aanzetten: domein verifiëren bij Resend → `EMAIL_FROM`-secret zetten → cron uit migratie 034 terugzetten → `#email-remind-row` in index.html weer tonen. `RESEND_API_KEY` staat al als secret.

## PCS scraping
Parse-logica staat in `supabase/functions/_shared/pcs-parse.ts` (getest!):
- PCS uses a **tabbed interface** (`ul.restabs` / `ul.resultTabs`) with tabs: Stage, GC, Points, KOM, BONIS
- Each tab has `data-id` linking to `div.resTab[data-id="..."]` containing a `table.results`
- **TTT (ploegentijdrit)**: STAGE-tab heeft géén `table.results` maar `ul.list.ttt-results` — per team een blok met teamtijd (`div.time`, formaat `32:52.170` mét milliseconden) en een geneste rennertabel; individuele achterstand in `<font class="blue">+0:14</font>`. Rennertijd = teamtijd + eigen gap.
- **Bonification**: in `td.ar.cu600`, uses `″` (U+2033) for seconds. Multiple values (e.g. `2″-20″`) are summed. BONIS-tab overschrijft indien aanwezig.
- **DNF/DNS/OTL/DSQ**: detected by checking ALL cells in a row (not just the time cell)
- Manual DNF overrides are preserved on re-sync (migration 029)
- URL-vorm: gebruik `/race/<slug>/<jaar>/stage-N` (zonder `.php`); Cloudflare blokkeert kale curl-requests, de edge function (datacenter-IP + browser-UA) komt er wel door
- Bij HTML-wijzigingen door PCS: test eerst live met Playwright/browser, leg de structuur vast in een test in `supabase/functions/tests/pcs-parse.test.ts`

## Common commands
```bash
# Deploy edge function (let op --no-verify-jwt voor browser-aangeroepen/cron-functies)
supabase functions deploy <naam> [--no-verify-jwt] --project-ref hdkvirtytljnuawcmoui

# Apply migrations (nummers moeten uniek zijn — duplicaat = duplicate key error)
supabase db push

# Live database bevragen (snelste manier om productie te inspecteren)
supabase db query "select ..." --linked

# Cron-runs en edge-function-responses debuggen
supabase db query "select * from cron.job_run_details order by start_time desc limit 5" --linked
supabase db query "select status_code, left(content,200), created from net._http_response order by created desc limit 5" --linked

# Tests (PCS-parsing + web push)
deno test --allow-read supabase/functions/tests/

# Frontend
npm run build       # Vite → dist/
npm run typecheck   # baseline ~56 errors, niet afgedwongen
npm run preview     # lokale test van dist/

# Secrets
supabase secrets list
supabase secrets set NAAM=waarde
```
