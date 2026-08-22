---
name: pcs-sync
description: Hoe etappe-resultaten én startlijsten/race-data van ProCyclingStats (PCS) worden gescraped en opgeslagen — de parser (_shared/pcs-parse.ts), het verschil tussen sync-pcs-results / auto-sync / admin-flow, de race-import (sync-pcs-race met bib-regels), renner-matching naar rider_id, en de PCS-HTML-valkuilen (TTT, ITT, bonificaties, startlijst). Gebruik dit bij elke wijziging aan scraping, sync-functies, startlijst-import of als resultaten/tijden/renners niet of verkeerd binnenkomen.
---

# PCS-sync pijplijn

Resultaten komen van ProCyclingStats (PCS) via scraping. De parse-logica is gedeeld en getest; de sync-paden eromheen verschillen.

## De gedeelde parser — gebruik altijd deze

`supabase/functions/_shared/pcs-parse.ts` → `parseStagePage(doc)` geeft `StageResult[]` terug met `{ bib_number, pcs_slug, pcs_name, time_seconds, finish_position, points, mountain_points, bonification_seconds, dnf }`.

Getest in `supabase/functions/tests/pcs-parse.test.ts`. Draaien:
```bash
deno test --allow-read supabase/functions/tests/
```

**Importeer deze parser overal** — schrijf geen inline kopie. (auto-sync had vroeger een eigen kopie die uit de pas liep en de startlijst-guard miste.)

## Drie sync-paden

1. **`sync-pcs-results`** (edge function, browser-aangeroepen, `--no-verify-jwt`): fetcht een PCS-URL, parset met `parseStagePage`, **geeft alleen de resultaten terug** (slaat niets op). De admin-frontend roept dit aan, koppelt renners en slaat dan op.
2. **`auto-sync`** (cron, 9:00 + 16:00 UTC): pakt alle etappes van *vandaag*, bouwt zelf de PCS-URL (zie hieronder), parst, koppelt renners en slaat op via `admin_save_results`. Eist `x-cron-secret`.
3. **Admin-knop** in `public/admin.ts`: bouwt URL met `buildPcsStageUrl(comp, stageNumber, stage)` → `sync-pcs-results` → `buildPcsPayload` (renner-matching) → `admin_save_results`.

## URL bouwen — de link staat op de RONDE

Bij een meerdaagse ronde staat de PCS-link op `competitions.pcs_url` (`.../race/tour-de-suisse/2026`), **niet** op elke etappe (`stages.pcs_url` is dan NULL). De etappe-URL wordt opgebouwd:

- eigen `stage.pcs_url` (klassiekers-bundel) → `<base>/result`
- anders `comp.pcs_url` → `<base>/stage-<N>` (of `/prologue` bij stage_number 0, of `/result` bij one-day)

Frontend: `public/helpers.ts` → `buildPcsStageUrl`. Auto-sync heeft een spiegel hiervan (`buildStageUrl`). Houd ze gelijk.

URL-vorm: `/race/<slug>/<jaar>/stage-N` (zónder `.php`). Voor het ophalen zelf: zie **Cloudflare-blok & renderproxy** hieronder — kale curl naar PCS krijgt altijd 403.

## Cloudflare-blok & renderproxy (sinds 22 aug 2026)

Op de openingsdag van de Vuelta 2026 zette PCS een Cloudflare **JS-challenge** aan die álle niet-browser-requests blokkeert — ook het datacenter-IP van de Supabase edge functions. Symptoom: elke sync faalt met `PCS status 403`, admin krijgt fout-pushes, `net._http_response` toont de 403 in de sync-result-JSON.

`_shared/pcs-fetch.ts` lost dit op met een **fallback naar de r.jina.ai-renderproxy**, die de challenge in een echte browser oplost en de volledige HTML teruggeeft (de geteste parser werkt daar 1-op-1 op):

- **Direct blijft primair** (sneller, gratis). Fallback bij een 403 (meteen, retry is zinloos) of na uitgeputte retries op 5xx/429/netwerkfout.
- Proxy-call: `https://r.jina.ai/<volledige-pcs-url>` met headers `X-Return-Format: html` (rauwe HTML i.p.v. markdown) en `X-No-Cache: true` (verse render — uitslagen veranderen, jina cachet standaard).
- **`JINA_API_KEY`** is een optionele Supabase-secret (`supabase secrets set JINA_API_KEY=...`) voor hogere rate limits; zonder key werkt de proxy ook maar met IP-gebonden limieten. Bij een volledige race-import (21 etappes) kan de gratis tier gaan knijpen — dan key zetten.
- Een proxy-render duurt ~10–60 s. pg_net wacht maar kort → `net._http_response` kan `NULL` tonen terwijl de functie gewoon doorloopt en slaagt; kijk dan naar `stage_results` of de function-logs.

**Error logging**: elke mislukte poging en elke fallback logt met `[pcs-fetch]`-prefix naar de edge-function-logs (dashboard → Functions → \<functie\> → Logs), inclusief poging-teller, URL en bij proxy-fouten een body-snippet (jina zet de echte reden — rate limit, render-fout — in de body). Falen béide kanalen, dan gooit `fetchPcsPage` één fout die het hele verhaal vertelt, bv. `PCS 403 (Cloudflare-blok) én renderproxy faalde (proxy status 429, 2 pogingen, geen JINA_API_KEY)` — die tekst belandt in sync-results, admin-pushes en `net._http_response`. Gedrag is vastgelegd in `tests/pcs-fetch.test.ts`.

Lokaal testen: de jina-URL curl-en (mét de twee headers) en de HTML door `parseStagePage` halen; direct naar PCS curl-en geeft altijd de challenge-pagina ("Just a moment...", title-tag checken).

## Renner-matching → rider_id (verplicht vóór opslaan)

`admin_save_results` verwacht per item een **`rider_id`**, niet slug/bib. Koppeling (zelfde in frontend `buildPcsPayload` en in auto-sync):

1. op `pcs_slug`, gepickte renner eerst, anders eerste match;
2. anders op `bib_number`, gepickte renner eerst, anders eerste match.

Renners staan per competitie in `riders` (`id, pcs_slug, bib_number, competition_id`). Bibnummers wisselen per koers → match bij voorkeur op `pcs_slug`.

## PCS-HTML-valkuilen (allemaal getest)

- **Tabbed interface**: `ul.restabs`/`ul.resultTabs` met tabs STAGE/GC/POINTS/KOM/BONIS; elke tab heeft `data-id` → `div.resTab[data-id]` met een `table.results`. Pak expliciet de STAGE-tab, anders pakt de scraper de GC-tabel.
- **Wegrit tijd-cel**: `<font>3:34:46</font><span class="hide">3:34:46</span>` — de zichtbare tijd staat (verdubbeld) ook in de hide-span. Strip het hide-duplicaat van het einde.
- **ITT/proloog tijd-cel**: `26.37<font class="fs10">,99</font><span class="hide"></span>` — tekstnode = tijd, font = honderdsten, hide-span leeg. Format is `M.SS,hh` (punt scheidt min/sec, komma = honderdsten). `parseTime` normaliseert de resterende punt naar `:` na het strippen van de honderdsten. Winnaar = absolute tijd, rest = achterstand.
- **TTT (ploegentijdrit)**: STAGE-tab heeft géén `table.results` maar `ul.list.ttt-results`; per team een blok met teamtijd (`div.time`, `32:52.170` mét ms) en een geneste rennertabel; individuele achterstand in `<font class="blue">+0:14</font>`. Rennertijd = teamtijd + eigen gap.
- **Bonificaties**: in `td.ar.cu600`, secondeteken `″` (U+2033); meerdere waarden (`2″-20″`) worden gesommeerd. De BONIS-tab overschrijft indien aanwezig.
- **DNF/DNS/OTL/DSQ**: gedetecteerd door álle cellen van een rij te checken, niet alleen de tijdcel.
- **Startlijst-guard**: vóór de etappe gereden is toont PCS de startlijst (renners, geen tijden). `parseStagePage` gooit dan een fout ("Geen tijden gevonden — startlijst"). De sync-paden moeten die fout afvangen en **niets opslaan / de etappe niet locken**.

Wijzigt PCS de HTML? Test eerst live (Playwright/Deno-fetch), leg de nieuwe structuur vast in een test in `pcs-parse.test.ts`, en pas dan de parser aan.

## Race-import: `sync-pcs-race` (etappes + startlijst)

Aparte edge function (browser-aangeroepen door admin, eigen inline parsers — níet `pcs-parse.ts`, dat is alleen voor uitslagen). Drie modes via de request-body:

1. **Volledige race-sync** (`{pcs_url, competition_id}`): parset `/stages` (of de overzichtspagina bij `is_one_day`), haalt per etappe profiel-afbeelding + starttijd op, parset `/startlist`, upsert `stages` en `riders`. Bestaande etappes behouden `locked`; `start_time`/`deadline` worden alleen overschreven als PCS een echte tijd geeft.
2. **Startlijst-only** (`{..., startlist_only: true}`): alleen renners bijwerken, etappes/race-info onaangeraakt.
3. **Per-etappe** (`{..., stage_id}`): voor de klassiekers-bundel — race-info + startlijst van de etappe-eigen `stages.pcs_url`, en vult `stage_riders` (delete + insert per etappe).

### Bib-regels (de valkuil van juli 2026)

Vóór de koers toont PCS `-` als bib; de parser verzint dan een volgnummer uit DOM-volgorde. Die volgorde wisselt per sync → bij re-sync botsen bibs op `UNIQUE(competition_id, bib_number)` en sneuvelen inserts **stil** (Tour: 180 opgehaald, 136 in DB). Daarom:

- **Neem nooit de bib uit de parse over** bij een update: bestaande renners houden hun bib (intern placeholder).
- Nieuwe renners krijgen `max(bib_number) + 1`.
- Match altijd eerst op `pcs_slug`; bib-match alleen als fallback én alleen als het DB-record zelf géén `pcs_slug` heeft (anders overschrijf je een andere renner, met verkeerde foto's via `global_rider_id` tot gevolg).
- Startlist-only verwijdert renners die van de lijst zijn — alleen op `pcs_slug`-basis, nooit op bib, en nooit als de renner picks heeft.

### Verrijking & bijzaken

- Nieuwe renners worden verrijkt uit `global_riders` (foto, nationaliteit, specialties) via `pcs_slug`; ontbrekend global-record wordt ge-upsert zodat `global_rider_id` altijd gezet is.
- **Foto's** komen apart via `sync-pcs-photos` (te traag voor één request; 200ms rate-limit per renner).
- **Specialties én nationaliteit** vernieuwt de cron `cron-refresh-specialties` wekelijks (ma 3:00 UTC): batch van 50 renner-pagina's per run (oudste `specialty_refreshed_at` eerst). Nationaliteit komt van dezelfde pagina (`Nationality: … <a href="nation/…">Land</a>`). Valkuil: ruwe PCS-HTML heeft `<a  href` (dubbele spatie) → regex met `\s+`. Backfill forceren: `update riders set specialty_refreshed_at = null where competition_id = <id>` en de functie een paar keer aanroepen tot `remaining` niet meer daalt.
- PCS-tijden zijn CET/CEST — `cetOffsetForDate` bepaalt de UTC-offset; hou die logica in stand bij starttijd-wijzigingen.
- **PCS her-shardt afbeeldings-URLs** (`/images/profiles/xx/yy/…`) soms massaal (juli 2026: 20/21 TdF-profielen dood). auto-sync ververst `profile_image_url` daarom uit de toch al gefetchte stagepagina. De officiële ASO-visuals (`stages.official_profile_image_url` + `route_map_url`, migratie 065, handmatig van letour.fr) blijven buiten elke sync — nooit overschrijven.

## Debuggen

```bash
# Welke etappes hebben (geen) resultaten?
supabase db query "select stage_id, count(*) from stage_results where stage_id in (...) group by stage_id" --linked
# Cron-runs en pg_net-responses
supabase db query "select * from cron.job_run_details order by start_time desc limit 5" --linked
supabase db query "select status_code, left(content,200), created from net._http_response order by created desc limit 5" --linked
```

Let op: `net._http_response` met `status_code`/`content` = NULL is meestal een pg_net-timing/niet-vastgelegde response, **geen** Cloudflare-blok. Een echt blok geeft 403/503 met content. `last_synced_at` op de competitie wordt door de admin-sync gezet, niet door auto-sync.

## ETA-sync & niet-starters (sinds 4 juli 2026, migratie 072)

- **`auto-sync-eta`** (cron */15 min, body `{"mode":"eta"}`): auto-sync synct in
  deze mode alleen etappes waarvan `stages.estimated_end_time` + 20 min
  verstreken is én die nog geen `stage_results` hebben. Skips zijn geen
  failures. De vaste 9:00/16:00 UTC-runs blijven als correctie-pass (die
  syncen wél opnieuw, voor PCS-correcties/bonis). Admin-push bij fouten geldt
  in eta-mode pas als de etappe >7u geleden startte (anti-spam op de kwartier-cadans).
- **`auto-dns-check`** (cron */30 min): voor etappes met een deadline binnen
  3 uur wordt `<race-base>/results/dropouts` geparset
  (`_shared/pcs-dropouts.ts`, getest) — tabel met Stage/Rider/Type-kolommen,
  rider-slug uit de href. Nieuwe uitvallers → `riders.dnf = true` (submit_pick
  blokkeert ze dan al); spelers met een pick op zo'n renner voor die etappe
  krijgen éénmalig een push (alleen bij de run die de renner markeert).
