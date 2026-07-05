---
name: scoring-klassementen
description: Hoe de vier klassementen van het wielerspel scoren (GC/punten/berg/spel), waar de logica leeft (views general_classification + stage_picks_public) en de exacte straf-regels voor DNF/DNS/te-laat. Gebruik dit bij elke wijziging aan scoring, klassementen, picks-afhandeling of de twee views.
---

# Scoring & klassementen

Het wielerspel: elke speler kiest 1 renner per etappe vóór de starttijd (deadline). Een renner mag maar één keer per competitie gebruikt worden. Er zijn vier klassementen die parallel lopen.

## Waar de logica leeft

**Alles zit in twee SQL-views**, niet in de frontend en niet in edge functions:

- `general_classification` — totalen per speler per competitie (GC-tijd, punten, berg, spel, strijdlust, stages_played).
- `stage_picks_public` — per pick per etappe de afgeleide waarden (time_gap, dnf_penalty_gap, effective_points enz.).

Beide views worden **als owner** uitgevoerd en omzeilen RLS bewust — zodat klassementen compleet blijven, ook met renners/picks die een speler zelf niet mag zien.

De views worden telkens in één migratie volledig opnieuw gedefinieerd (`DROP VIEW` + `CREATE VIEW`). De laatste volledige definitie is leidend (**nu migratie 074**) — zoek de hoogst genummerde migratie die `CREATE VIEW general_classification` bevat:

```bash
grep -rl "CREATE VIEW general_classification" supabase/migrations/ | sort
```

Wil je iets aan scoring wijzigen? Maak een **nieuwe migratie** met de volledige nieuwe view-definitie (kopieer de vorige, pas aan). Nooit in-place ALTER — het zijn views.

## De vier klassementen

1. **Algemeen Klassement (GC)** — som van tijdverschillen t.o.v. de etappewinnaar, minus `bonification_seconds` uit `stage_results`. Geen sharing-straf.
2. **Puntenklassement** — som van sprintpunten (PCS Points Classification). Geen sharing-straf.
3. **Bergklassement** — som van KOM-punten (PCS Mountain/KOM Classification). Geen sharing-straf.
4. **Spelklassement** — punten op finishpositie (1e=100, 2e=80, … 20e=5) mét sharing-straf: als meer spelers dezelfde renner kiezen daalt de opbrengst via `sharing_multiplier(num_pickers)`. Dit zit in `game_points` (kolom op `stage_results`, berekend door `calculate_game_points(stage_id)`) × multiplier.
   - **`num_pickers` telt alleen bewuste, scorende picks** (`WHERE NOT is_late AND NOT is_random` in de `rider_pick_counts`-CTE, migratie 074). Te-late picks (scoren 0) en Rad-toewijzingen tellen dus niet mee — anders werd de eerlijke, op-tijd-picker gestraft omdat een ander te laat was of het Rad dezelfde renner toewees.

`scoring_mode` op de competitie (`grand_tour` / `classic`) bepaalt welke klassementen tonen.

## Straf-regel (de subtiele kern)

Een gekozen renner die **niet finisht** (DNF/DNS/OTL/DSQ) of een **te-late pick** levert geen punten en een GC-straf op:

- **GC/tijd-straf** = het *slechtste tijdverschil van het hele veld* (de hekkensluiter) op die etappe. Geldt gelijk voor elke niet-finisher/te-laat (migratie 063). (Eerder, migr. 059/062, was dit de slechtste gekozen finisher met veld-fallback — vervangen omdat niet-finishen dan even mild kon tellen als de traagste gekozen finisher.)
- **Punten/berg/spel** = 0.

### "Niet gefinisht" = geen finish-positie

Cruciaal (migratie 062): "niet gefinisht" wordt bepaald op `sr.finish_position IS NULL`, niet alleen op `sr.dnf = true`. Reden: een renner die niet startte en door PCS **helemaal niet in de uitslag** wordt vermeld, heeft **geen `stage_results`-rij**. De `LEFT JOIN` gaf dan NULL → `dnf` werd false → tijdverschil `GREATEST(0 - winnertijd, 0)` = 0 → de renner kreeg ten onrechte de winnaarstijd ("zt", zelfde tijd) i.p.v. de straf.

`sr.finish_position IS NULL` dekt zowel de dnf-rij (positie NULL) als de ontbrekende rij (DNS). In `general_classification` zit dit in de CTE-alias `dnf`; in `stage_picks_public` staat het inline per CASE-trigger (`p.is_late OR COALESCE(sr.dnf,false) OR sr.finish_position IS NULL`).

Een finisher heeft altijd een `finish_position` én `time_seconds > 0` (zie pcs-sync). Late picks worden apart via `picks.is_late` afgehandeld.

## Hoe een resultaat in de DB komt

- `stage_results` (één rij per renner per etappe): `time_seconds` (absolute tijd, winnaar + achterstand), `finish_position` (NULL bij dnf), `points`, `mountain_points`, `game_points`, `bonification_seconds`, `dnf`, `manually_edited`.
- Opslaan gebeurt via RPC **`admin_save_results(p_stage_id, p_results, p_manual)`** (SECURITY DEFINER). Verwacht per item **`rider_id`** (niet slug/bib) — koppeling renner→rider_id moet vooraf. Roept `assign_random_riders` (Rad van Fortuin voor late/geen pick) en `calculate_game_points` aan, en lockt de etappe. Mag aangeroepen door een ingelogde admin óf de service_role (cron) — zie migratie 061.
- `bonification_seconds` staat per renner opgeslagen (gescraped of handmatig), NIET afgeleid van finishpositie.
- Handmatig bewerkte rijen (`manually_edited=true`) worden bij re-sync niet overschreven.

## Valkuilen

- Verander je de straf/dnf-semantiek, doe het op **beide** views consistent (GC + stage_picks_public), anders wijken klassement-totaal en per-etappe-weergave af.
- Een finisher met `time_seconds = 0` zou nu als "niet gefinisht" gelden — dat hoort niet voor te komen (parser geeft finishers altijd > 0), maar houd het in gedachten bij handmatige invoer.
- Test een view-wijziging altijd live: `supabase db query "select * from general_classification where competition_id=<id> order by total_time limit 5" --linked`.
