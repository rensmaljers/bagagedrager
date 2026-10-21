---
name: nieuwe-competitie
description: Het draaiboek voor een nieuwe ronde of klassiekers-campagne — competitie aanmaken (incl. tijdzone en categorie), race + startlijst importeren via sync-pcs-race (met de bib-regels), controleren, ASO-visuals en logo seeden, inschrijving ("Ik doe mee") en inschrijf-pushes, pot/inleg en live zetten. Inclusief het klassiekers-format (per-etappe pcs_url + stage_riders). Gebruik dit bij het opzetten van een nieuwe Tour/Giro/Vuelta/klassiekers-competitie of vragen over deelnemers, pot of stage_riders.
---

# Nieuwe competitie opzetten

## Draaiboek (volgorde)

1. **Competitie aanmaken** — Admin → Rondes (`addComp`): `name`, `slug`, `year`, `competition_type` (tour/giro/vuelta/classic), `scoring_mode` (`grand_tour` of `classic`), `is_one_day`, `pcs_url`, kleur/vlag. `is_active` start op false.
2. **Tijdzone en categorie zetten — vóór de import** (Admin → Rondes, keuzelijsten):
   - `timezone` (standaard `Europe/Amsterdam`): PCS-starttijden zijn **lokale koerstijd**; de import rekent ermee naar UTC (`_shared/tz.ts`). Race buiten Midden-Europa (China, Australië, Canada, Golf…) → eerst goed zetten, anders liggen alle deadlines uren verkeerd. Achteraf gewijzigd → opnieuw importeren.
   - `category` (`grote_ronde` / `worldtour` / `klassieker` / `vrouwen`, standaard `worldtour`): groepering in de spelergeschiedenis. Giro/Tour/Vuelta → grote ronde; vrouwenkoersen → vrouwen.
   - `year` is bewerkbaar (bepaalt sortering/groepering in de geschiedenis).
3. **Race importeren** — Admin → Import → `syncRace` (edge function `sync-pcs-race`, volledige mode): maakt etappes aan (start_time, deadline = start_time, `estimated_end_time` = start + km/40 + 1u, race-info, PCS-profielafbeelding) én de startlijst (riders + team-shirts + `global_riders`-koppeling). Werkt met de oude én de nieuwe PCS-layout (sinds eind sept 2026; zie skill `pcs-sync`) — in de nieuwe layout staat in het log `ℹ️ Nieuwe PCS-layout: N etappes uit het etappemenu…` en duurt het langer (elke etappepagina apart via de renderproxy).
4. **Import controleren** (snelst via `supabase db query "…" --linked` of de publieke REST met de anon-key):
   - aantal etappes = aantal op PCS; datums en **deadlines in NL-tijd** kloppen met de lokale starttijd (bv. 10:30 China = 04:30 NL in de zomertijd);
   - `stage_type` per etappe vs. het PCS-icoon (`p1` vlak … `p5` bergop — alleen het losse token telt, niet `mg_rp4`);
   - aantal renners ≈ PCS-startlijst.
5. **Foto's** — `syncPhotos` (batches van 25); specialties + nationaliteit vult de wekelijkse cron (`cron-refresh-specialties`, 50 renners/run, oudste eerst) geleidelijk aan.
6. **Visuals seeden** — ASO-profiel/kaart/interactieve kaart hebben **geen admin-UI en geen sync**: handmatig scrapen van letour.fr en per SQL-UPDATE zetten — zie skill `etappe-visuals`. Ronde-logo via het `logo_url`-veld in de rondetabel.
7. **Pot** — `entry_fee` + `payment_url` (betaalverzoek-link, migratie 078) op de competitie; admin vinkt `has_paid` af in Admin → Deelnemers & inlegpot (`competition_participants`). Frontend leest via view `competition_pot_status` (`paid_at` blijft privé).
8. **Live** — `is_active = true`, ruim vóór de start. Vanaf dan:
   - **Inschrijven** ("Ik doe mee" op dashboard/keuzescherm, met spelregels-akkoord → `join_competition`) kan tot de eerste etappe start; daarna alleen de admin via Admin → Deelnemers & inlegpot (`admin_add_participant`, geeft te-late Rad-picks voor gestarte etappes).
   - **Inschrijf-pushes** (`auto-join-remind`, elk uur): "Inschrijving geopend" zodra de ronde actief is en etappes heeft, en "Laatste kans" binnen 24 u vóór de start — naar actieve, niet-AI spelers die nog niet ingeschreven zijn. Daarom: **eerst importeren, dan activeren** (zonder etappes wacht de open-push).
   - Daarnaast de bekende crons (auto-sync op `estimated_end_time`, auto-rad, auto-remind, auto-dns-check — zie skill `cron-edge-functions`).
   - Kondig de ronde ook zelf aan (groepsapp): niet iedereen heeft push aan, en iOS-push werkt alleen als geïnstalleerde PWA.
9. **Na etappe 1** — controleer of de uitslag compleet binnenkwam: tijden, posities, **punten én bergpunten** (bij de Tour of Guangxi 2026 bleven punten eerst 0 door een andere PCS-kolomnaam). Herstel: fix deployen + per etappe PCS-sync in Admin.

### Checklist (kort)

- [ ] Ronde aangemaakt met juiste `pcs_url`, `year`, `scoring_mode`
- [ ] Tijdzone en categorie gezet
- [ ] Geïmporteerd; etappes/deadlines/types/renners gecontroleerd
- [ ] Inleg + betaallink ingevuld (als er een pot is)
- [ ] Geactiveerd ruim vóór de start (pushes lopen dan vanzelf) en zelf aangekondigd
- [ ] Na etappe 1: uitslag incl. punten/bergpunten gecontroleerd

## Spelers uitnodigen

Nieuwe spelers (nog geen account): invite-link genereren (Admin → Gebruikers, RPC `create_invite`; verzilveren via `resolve_invite`/`redeem_invite`, migratie 076). Een account is iets anders dan deelname: per ronde schrijft een speler zich zelf in (stap 8).

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
- Wél rijen → `submit_pick` weigert renners buiten die subset ("Deze renner start niet in deze etappe"), en het Rad (`assign_random_riders`) en `admin_add_participant` kiezen alleen daaruit. (Deze server-side check was in migratie 051 weggevallen en is hersteld in `20261021130000_stage_riders_check`; de keuzelijst in de app filtert los daarvan ook.) Die startlijst is ook leidend boven een DNF uit een eerdere koers (wie start, mag gekozen worden). Renners die PCS op de koers-startlijst als DNS markeert, worden niet gekoppeld — bij late afmeldingen de koers opnieuw syncen (Etappes-tab → per-etappe sync).
- Import-flow: per etappe PCS-URL zetten (Etappes-tab) → `syncStageFromPcs` per koers.

## Datamodel-spiekbrief

- `competitions`: slug UNIQUE, `scoring_mode`, `is_one_day`, `pcs_url`, `entry_fee`, `payment_url`, `logo_url`, `color`, `country_flag`, `is_active`, `timezone`, `category`, `join_open_notified_at` / `join_reminder_sent_at` (vlaggen inschrijf-pushes).
- `competition_participants`: deelnemer per ronde (`joined_at`, `rules_accepted_at`/`rules_version`, `dns_at`, `has_paid`).
- `stages`: UNIQUE(competition_id, stage_number); `deadline` = start_time; `estimated_end_time` stuurt auto-sync-eta; ASO-visualkolommen zijn sync-vrij.
- `riders`: **per competitie**, UNIQUE(competition_id, bib_number), `pcs_slug` = matching-sleutel, FK `global_rider_id`.
- `global_riders`: één rij per renner over alle competities (key `pcs_slug`); foto-wijziging propageert via trigger naar alle gekoppelde riders.
- `profiles.is_ai` (069): AI-spelers — hun picks zijn vóór de deadline zichtbaar als voorvertoning; verder normale picks. Geen deelpenalty-effect (alleen bewuste picks tellen, migratie 074).
