---
name: migraties
description: De migratie-werkwijze — nummering (NNN_naam.sql, uniek, volgende = hoogste+1), het leidende-migratie-principe (views/RPC's volledig herdefiniëren vanuit hun láátste definitie), db push direct op productie, de search_path-reset bij CREATE OR REPLACE, en database.types.ts hergenereren na schema-wijzigingen. Gebruik dit bij elke nieuwe migratie, schema-wijziging, view-/RPC-aanpassing of als db push faalt.
---

# Migraties

Kernprincipe: **er is geen staging — migraties draaien direct op productie.** Dat gebeurt langs twee wegen: lokaal via `supabase db push`, én automatisch via GitHub Actions (`.github/workflows/deploy.yml` draait `db push` bij elke push naar `main` die `supabase/migrations/**` raakt). **Een migratie naar `main` pushen = hem deployen.** Elke migratie is definitief; denk vooraf na over bestaande rijen (backfill/defaults) en test lees-varianten eerst met `supabase db query "select ..." --linked`.

## Nummering & bestandsvorm

- Bestandsnaam: `NNN_korte_naam.sql` (drie cijfers). Het nummer is de versie die Supabase bijhoudt — **duplicaat nummer = duplicate key error bij `db push`**.
- Volgende nummer = hoogste bestaande + 1: `ls supabase/migrations | tail -1`.
- Begin elk bestand met een commentaar-header: wat en **waarom** (welke bug/aanleiding), zoals 079/080 doen. Skills en CLAUDE.md verwijzen naar migratienummers — die header is de documentatie.
- Wat al live staat checken: `supabase migration list --linked`.

## Het leidende-migratie-principe

Views, RPC's en cron-schedules worden bij wijziging **volledig opnieuw gedefinieerd in een nieuwe migratie** — nooit gepatcht. De hoogst genummerde definitie wint. Wijzig je er één:

1. Kopieer de complete definitie uit de huidige leidende migratie (niet uit een oudere — daar missen latere fixes in).
2. Pas aan in een nieuwe migratie.
3. Werk de verwijzing naar het leidende nummer bij in CLAUDE.md én de betreffende skill.

| Object | Leidende migratie |
|---|---|
| Views `general_classification` + `stage_picks_public` | 075 |
| Pick-RPC's (`submit_pick`/`withdraw_pick`/`assign_random_riders`/`admin_upsert_pick`/`admin_delete_pick`) | 077 |
| View `competition_pot_status` | 074 |
| Trigger `guard_profile_privileges` | 073 |
| Cron-schedules | per job — zie tabel in skill `cron-edge-functions` |

## Valkuilen

- **`CREATE OR REPLACE FUNCTION` reset de proconfig** — bij elke herdefinitie van een `SECURITY DEFINER`-functie de `SET search_path = public` opnieuw inline meegeven (060, expliciet gedocumenteerd in 077).
- Nieuwe view op een RLS-tabel draait als owner en lekt standaard álles — bewust kolommen/filters kiezen of `security_invoker=true`; zie skill `rls-security`.
- Nieuwe tabel? Loop de checklist onderaan skill `rls-security` af (RLS aan, minimale policies, schrijven via RPC of admin-policy).
- Nieuwe cron niet strakker dan `*/15` zonder reden (Disk IO Budget, migratie 079) en bedenk dat `cron.job_run_details` na 7 dagen gepurged wordt (080).

## Na een schema-wijziging

```bash
supabase db push                    # direct toepassen (óf: committen naar main — CI pusht dan)
supabase gen types typescript --linked > src/lib/database.types.ts   # types hergenereren
npm run typecheck                   # 0-errors-gate — frontend mee-updaten als hij breekt
```

Raakt de wijziging een view die de frontend leest (klassementen, pot), verifieer dan live — zie skill `verify`.
