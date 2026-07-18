# Bagagedrager — Het Wielerspel

## Project overview
Fantasy cycling game ("wielerspel") where players pick one rider per stage and compete across four classifications. Built as a single-page app with Supabase backend.

- **Live**: https://bagagedrager.netlify.app (geen eigen domein; e-mail staat daarom uit, zie Notificaties)
- **Supabase project-ref**: `hdkvirtytljnuawcmoui`

## Tech stack
- **Frontend**: Svelte 5 (runes) + TypeScript, eigen CSS op design-tokens (geen Bootstrap meer), Vite build. **Sinds 5 juli 2026 live** (Svelte-migratie gemerged, commit `f0468cc`; de oude vanilla-TS in `public/*.ts` bestaat niet meer).
- **Backend**: Supabase (PostgreSQL + Edge Functions + Auth + RLS + pg_cron)
- **Hosting**: Netlify — auto-deploy bij push naar `main`, build `npm run build`, publish `dist/`. Deploy is atomisch (~15-30s), nul downtime.
- **Data source**: ProCyclingStats (PCS) scraping for race results

## Architecture
- All business logic lives in PostgreSQL functions and views (`supabase/migrations/`)
- Edge Functions in `supabase/functions/` handle PCS scraping, cron-taken en admin operations
- Frontend communicates via Supabase REST API (PostgREST) + één realtime channel
- Git workflow: commit and push directly to `main`. Grote/risicovolle features op een aparte branch, mergen na akkoord (bv. `rad-theater`).

## Skills (`.claude/skills/`)
Diepere kennis per domein — laad de skill vóór je in dat domein werkt:
- `frontend-architectuur` — App.svelte-shell, $state/appState, cache+stale-guard-patroon, realtime, {@html}, admin-lazy, build/SW
- `design-system` — tokens, trui-systeem, typografie, dark/light
- `scoring-klassementen` — de vier klassementen, views, DNF/te-laat-regels
- `rls-security` — policies per tabel, RPC-only picks, guard-trigger, owner-views
- `cron-edge-functions` — alle functies, auth-patronen, schedules, deploy, debuggen
- `notificaties` — web push end-to-end, service worker, e-mail-heraanzet
- `pcs-sync` — parser, sync-paden, renner-matching, PCS-HTML-valkuilen
- `nieuwe-competitie` — draaiboek nieuwe ronde/klassiekers, sync-pcs-race, bib-regels, pot/invites
- `etappe-visuals` — ASO-afbeeldingen scrapen en seeden
- `verify` — end-to-end browserverificatie (testaccount + Playwright)
- `migraties` — nummering, leidende-migratie-principe, db push direct op productie, types hergenereren
- `gezondheidscheck` — productie-runbook: cron-runs, edge-function-fouten, Rad/uitslag-status, site-check

## Claude Code-setup (`.claude/settings.json`)
- Permission-allowlist voor veilige commando's (typecheck/build/tests/git-leesacties/supabase-lists) — schrijvende acties (db push, deploy, git push) prompten altijd.
- Stop-hook `.claude/hooks/typecheck-stop.sh`: draait `npm run typecheck` zodra er ongecommitte wijzigingen in `src/` staan en blokkeert de beurt bij errors (de 0-errors-gate).
- Agent `pcs-debug` (`.claude/agents/`): PCS-scraping-problemen onderzoeken (parser vs. sync-pad vs. PCS-HTML-wijziging) — levert diagnose + fixvoorstel + test, grijpt zelf niet in.

## Key files (Svelte)
- `public/index.html` — slank mount-punt: inline kritieke CSS + fonts + theme-script + tooltip-engine + `<div id="svelte-root">`. Wat vóór de eerste paint zichtbaar is óók hier aanpassen.
- `public/style.css` — het volledige design system (geïmporteerd in main.ts). Componenten gebruiken deze klassen; secties Tokens→Base→Layout→Components→Views→Motion→Responsive.
- `src/main.ts` — `mount(App)`.
- `src/App.svelte` — shell: auth ↔ app, navbar, tab-routing (hash), realtime-channel, account, service-worker-registratie.
- `src/lib/state.svelte.ts` — gedeelde reactieve state (`$state`-runes) + `ui`-state. In .svelte-bestanden **altijd** `import { state as appState }` (anders ziet de compiler `$state` als store-subscription).
- `src/lib/*.ts` — api/config/utils/icons/helpers/supabase-client/notifications/**focus-trap**.
- `src/views/*.svelte` — Dashboard (klassementen+H2H+pot+RadTheater), Pick, History, Peloton, Admin (**lazy** via dynamic import), Account, PlayerModal, RiderModal, RadTheater, Auth.
- `supabase/functions/_shared/` — `pcs-parse.ts`, `pcs-fetch.ts` (retry/backoff), `pcs-dropouts.ts`, `webpush.ts` (allen getest), `email-template.ts`
- `supabase/functions/tests/` — Deno-tests (PCS-parsing incl. TTT/ITT, dropouts, pcs-fetch-retry, web push RFC 8291-vector)

### Valkuilen frontend
Volledig patroon-overzicht: skill `frontend-architectuur`.
- Wijzig je iets dat vóór de eerste paint zichtbaar is (body-achtergrond, thema, nav): pas het aan in **zowel** `public/index.html` (inline kritieke CSS) als `public/style.css`.
- HTML-string-helpers (`teamBadge`, `avatarHtml`, `riderDisplay`, `icon`) geven strings terug → renderen met `{@html ...}`. Niet herschrijven.
- Admin blijft lazy (dynamic import) — niets opstart-kritieks erin.
- `npm run typecheck` wijst naar `src/**` en staat op **0 errors** — houden zo (build-gate: svelte-check draait vóór elke build).
- Modals krijgen `use:focusTrap` (`src/lib/focus-trap.ts`) + `role="dialog"`/`aria-modal`.
- Async data-laders (loadStandings/loadParticipants/loadHistory): leg `const loadCompId = appState.activeCompId` vast en `return` vóór toewijzing als de ronde intussen wisselde (stale-guard).
- Live-verificatie tegen productie: zie `.claude/skills/verify` (testaccount + Playwright-recept).

## Scoring system (4 classifications)
1. **Algemeen Klassement (GC)** — Sum of time gaps to stage winner, minus `bonification_seconds` from `stage_results`. DNF/DNS/late = slechtste tijdverschil van het **hele veld** op die etappe (de hekkensluiter, migratie 063). No sharing penalty.
2. **Puntenklassement (Points)** — Sum of sprint points from PCS Points Classification. No sharing penalty.
3. **Bergklassement (Mountain)** — Sum of KOM points from PCS Mountain/KOM Classification. No sharing penalty.
4. **Spelklassement (Game)** — Points based on finish position (1st=100, 2nd=80, ..., 20th=5) with sharing multiplier penalty when multiple players pick the same rider. De deelpenalty telt **alleen bewuste, scorende picks** (`NOT is_late AND NOT is_random`, migratie 074) — te-late en Rad-picks straffen de eerlijke picker niet.

De klassementen zitten in de views `general_classification` en `stage_picks_public` (**laatst volledig gedefinieerd in migratie 075**; 074 verving 063 met de deelpenalty-fix). Views draaien als owner en omzeilen RLS — bewust, zodat klassementen compleet blijven.

## Game rules
- Pick 1 rider per stage before the start time (deadline = start_time)
- Each rider can only be used once per competition
- Late/no pick → "Rad van Fortuin" assigns a random unused rider; GC penalty = slechtste tijdverschil van het hele veld (migratie 063)
- DNF/DNS/OTL = same GC penalty as late; 0 points in all other classifications
- Bonification seconds stored per rider in `stage_results.bonification_seconds` (scraped from PCS or entered manually by admin). NOT derived from finish position.
- Klassiekers: één competitie met meerdere "etappes" (koersen) en per-etappe startlijsten in `stage_riders`
- Nieuwe ronde/competitie opzetten: zie skill `nieuwe-competitie`

## RLS (sinds migratie 058, gehardend in 073/074) — zie skill `rls-security`
- `picks`: eigen picks altijd leesbaar; van anderen pas na deadline/lock; admins alles. **INSERT-policy verwijderd (073)** — schrijven kan alléén via de RPC's `submit_pick`/`withdraw_pick`/`assign_random_riders`/`admin_upsert_pick`, zodat deadline/DNF/renner-al-gebruikt-regels niet te omzeilen zijn.
- `profiles`: publiek leesbaar; eigen profiel schrijfbaar behalve `is_admin`/`is_ai`/`email` — die kolommen blokkeert een trigger voor niet-admins (073, was een privilege-escalatie).
- `competition_participants`: basistabel alleen admin-leesbaar (paid_at privé); de pot leest `has_paid` uit de view **`competition_pot_status`** (074).
- SECURITY DEFINER-functies krijgen `SET search_path = public`.
- Realtime respecteert RLS — events voor verborgen rijen komen niet binnen.

## Cron & edge functions — zie skill `cron-edge-functions`
Cron-jobs (pg_cron + pg_net, zie `cron.job`):
- `auto-rad` (*/10 min) — Rad van Fortuin na deadline (`rad_assigned`-vlag voorkomt dubbel draaien)
- `auto-lock-stages` (*/10 min) — pure SQL UPDATE, geen edge function
- `auto-remind` (*/30 min) — push naar spelers zonder pick, 30–90 min voor deadline (`reminder_sent`-vlag)
- `auto-notify-results` (*/10 min) — **gepersonaliseerde** push zodra een uitslag binnen is (eigen renner + spelpunten + nieuwe positie; `results_notified`-vlag, migratie 068)
- `auto-sync-ochtend/-middag` (9:00/16:00 UTC) — PCS-resultaten syncen (correctie-pass/vangnet)
- `auto-sync-eta` (*/15 min, body `{"mode":"eta"}`) — synct een etappe zodra `estimated_end_time` + 20 min verstreken is en er nog geen resultaten zijn; skipt daarna. Uitslag staat ~20 min na de finish binnen (migratie 072)
- `auto-dns-check` (*/30 min) — parset PCS' dropouts-pagina voor etappes met deadline binnen 3 uur; zet `riders.dnf` + pusht spelers die een niet-starter kozen (migratie 072)
- `weekly-rider-specialty-refresh` (ma 3:00 UTC) — specialties **én nationaliteit** van de renner-pagina

Vlag-conventie voor push-crons: zet de "verzonden"-vlag (`results_notified`/`reminder_sent`) **vóór** de push-loop — een crash halverwege mag bij de volgende run geen dubbele meldingen geven. `webpush.sendPush` heeft een 5s-timeout zodat één hangend endpoint de loop niet blokkeert.

Conventies:
- **Cron-functies** eisen `x-cron-secret`-header; secret staat in `_app_config` (DB), op te vragen via `get_cron_secret()` RPC. Cron-jobs sturen hem mee.
- **Browser-aangeroepen functies** (sync-pcs-*, test-push, test-email) hebben CORS-headers + OPTIONS-handler nodig én `verify_jwt = false` (in `supabase/config.toml` + deploy met `--no-verify-jwt`), want de preflight kan geen JWT dragen. Auth gebeurt ín de functie (sessie + `profiles.is_admin`).
- **Deno crypto-valkuil**: VAPID private key importeren als JWK (d + x/y uit de public key) — minimale PKCS8 importeert wel maar `sign()` faalt met `InvalidEncoding` in de Supabase-runtime.
- Gedeelde code in `_shared/`; importeer nooit uit een andere functie-map (top-level `Deno.serve` van die functie kaapt dan alle requests).
- SECURITY DEFINER functies krijgen `SET search_path = public` (migratie 060).

## Notificaties — zie skill `notificaties`
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

# Frontend (Svelte 5 + Vite)
npm run build       # svelte-check (0-baseline, gate) → Vite → dist/
npm run typecheck   # tsc over src/** — 0 errors, houden zo
npm run preview     # lokale test van dist/ (localhost:4173)

# Secrets
supabase secrets list
supabase secrets set NAAM=waarde
```
