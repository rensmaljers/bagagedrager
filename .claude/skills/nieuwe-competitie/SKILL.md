---
name: nieuwe-competitie
description: Het draaiboek voor een nieuwe ronde of klassiekers-campagne — competitie aanmaken, race + startlijst importeren via sync-pcs-race (met de bib-regels), ASO-visuals en logo seeden, invite-links, pot/inleg en live zetten. Inclusief het klassiekers-format (per-etappe pcs_url + stage_riders). Gebruik dit bij het opzetten van een nieuwe Tour/Giro/Vuelta/klassiekers-competitie of vragen over deelnemers, pot of stage_riders.
---

# Nieuwe competitie opzetten

## Draaiboek (volgorde)

1. **Competitie aanmaken** — Admin → Rondes (`addComp`): `name`, `slug`, `year`, `competition_type` (tour/giro/vuelta/classic), `scoring_mode` (`grand_tour` of `classic`), `is_one_day`, `pcs_url`, kleur/vlag. `is_active` start op false.
2. **Race importeren** — Admin → Import → `syncRace` (edge function `sync-pcs-race`, volledige mode): maakt etappes aan (start_time, deadline = start_time, `estimated_end_time` = start + km/40 + 1u, race-info, PCS-profielafbeelding) én de startlijst (riders + team-shirts + `global_riders`-koppeling).
3. **Foto's** — `syncPhotos` (batches van 25); specialties + nationaliteit vult de wekelijkse cron (`cron-refresh-specialties`, 50 renners/run, oudste eerst) geleidelijk aan.
4. **Visuals seeden** — ASO-profiel/kaart/interactieve kaart hebben **geen admin-UI en geen sync**: handmatig scrapen van letour.fr en per SQL-UPDATE zetten — zie skill `etappe-visuals`. Ronde-logo via het `logo_url`-veld in de rondetabel.
5. **Deelnemers** — invite-link genereren (Admin → Gebruikers, RPC `create_invite`; verzilveren via `resolve_invite`/`redeem_invite`, migratie 076). Er is geen expliciete "join" per competitie — deelname blijkt uit picks.
6. **Pot** — `entry_fee` + `payment_url` (betaalverzoek-link, migratie 078) op de competitie; admin vinkt `has_paid` af in de Pot-tab (`competition_participants`). Frontend leest via view `competition_pot_status` (`paid_at` blijft privé).
7. **Live** — `is_active = true`. Vanaf dan doen de crons de rest (auto-sync op `estimated_end_time`, auto-rad, reminders — zie skill `cron-edge-functions`).

## sync-pcs-race — drie modi

Body `{ pcs_url, competition_id, stage_id?, startlist_only? }`, admin-only:

- **Volledig** (default): etappes + startlijst + rennerdetails. Upsert op `(competition_id, stage_number)`; behoudt `locked` en laat bestaande `start_time`/`deadline` staan als PCS geen echte tijd geeft.
- **`startlist_only: true`**: alleen startlijst verversen.
- **`stage_id`** (klassiekers): gebruikt `stages.pcs_url` van díe etappe, merget renners de competitie in én koppelt ze in `stage_riders` (delete + herinsert per stage).

### Bib-regels (niet omheen werken)

PCS-bibs zijn vóór de koers placeholders uit DOM-volgorde en wisselen per sync:
- Matchen op **`pcs_slug`**, nooit op geparste bib. Bestaande renners behouden hun bib; nieuwe krijgen `max(bib)+1`.
- Bib-fallback-match alleen als het bestaande record géén `pcs_slug` heeft.
- Renners verwijderen alleen op `pcs_slug` (niet meer op startlijst) én alleen zonder picks.
- Zonder deze regels botsen re-syncs op `UNIQUE(competition_id, bib_number)` en sneuvelen inserts stil.

## Klassiekers-format

Eén competitie met `competition_type='classic'`, `is_one_day=true`, `scoring_mode='classic'`; elke `stages`-rij = één koers met eigen `stages.pcs_url` (migratie 024). Startlijst per koers in **`stage_riders`** (migratie 038, PK `(stage_id, rider_id)`):

- **Geen `stage_riders`-rijen voor een etappe = volledige competitie-startlijst geldt** (grote rondes blijven zo werken).
- Wél rijen → `submit_pick` weigert renners buiten die subset ("Deze renner start niet in deze etappe") en het Rad (`assign_random_riders`) kiest alleen daaruit.
- Import-flow: per etappe PCS-URL zetten (Etappes-tab) → `syncStageFromPcs` per koers.

## Datamodel-spiekbrief

- `competitions`: slug UNIQUE, `scoring_mode`, `is_one_day`, `pcs_url`, `entry_fee`, `payment_url`, `logo_url`, `color`, `country_flag`, `is_active`.
- `stages`: UNIQUE(competition_id, stage_number); `deadline` = start_time; `estimated_end_time` stuurt auto-sync-eta; ASO-visualkolommen zijn sync-vrij.
- `riders`: **per competitie**, UNIQUE(competition_id, bib_number), `pcs_slug` = matching-sleutel, FK `global_rider_id`.
- `global_riders`: één rij per renner over alle competities (key `pcs_slug`); foto-wijziging propageert via trigger naar alle gekoppelde riders.
- `profiles.is_ai` (069): AI-spelers — hun picks zijn vóór de deadline zichtbaar als voorvertoning; verder normale picks. Geen deelpenalty-effect (alleen bewuste picks tellen, migratie 074).
