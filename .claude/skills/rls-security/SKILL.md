---
name: rls-security
description: Het security-model — RLS-policies per tabel, waarom picks alleen via SECURITY DEFINER RPC's schrijfbaar zijn (submit_pick/withdraw_pick/assign_random_riders/admin_upsert_pick), de profiles-guard-trigger tegen privilege-escalatie, owner-draaiende views die RLS bewust omzeilen, en de search_path-conventie. Gebruik dit bij elke nieuwe tabel, policy-wijziging, nieuwe RPC, admin-functionaliteit of security-vraag.
---

# RLS & security-model

Kernprincipe: **gevoelige schrijfpaden lopen via `SECURITY DEFINER` RPC's; RLS-policies zijn read-georiënteerd; klassement-/pot-data komt uit owner-draaiende views die RLS bewust omzeilen.** De frontend is géén beveiligingsgrens — `is_admin`-checks daar zijn puur cosmetisch.

## Policies per tabel (leidende migratie)

| Tabel | Lezen | Schrijven | Leidend |
|---|---|---|---|
| `picks` | eigen altijd; anderen na deadline/lock; admin alles | **géén policy — alleen RPC's** | 058 + 073 |
| `profiles` | publiek | eigen profiel (behalve guard-kolommen); admin alles | 001/002 + 073 |
| `competition_participants` | **géén SELECT** (paid_at privé) — pot via view | admin FOR ALL | 047 + 074 |
| `stages`, `riders`, `competitions`, `stage_results`, `stage_riders`, `global_riders`, `team_shirts` | publiek | admin (of alleen service-role) | 001/002 e.v. |
| `push_subscriptions` | eigen FOR ALL (`auth.uid()=user_id`) | idem | 033 |
| `invite_codes` | admin-only; anon via RPC `resolve_invite` | admin | 076 |
| `pick_audit_log` | admin-only | **alleen trigger** schrijft | 077 |
| `_app_config` | REVOKE van anon/authenticated — alleen service-role | idem | 042 |

## Picks: RPC-only writes (waarom, migratie 073)

De oude INSERT-policy checkte alleen `auth.uid()=user_id` — een directe REST-INSERT omzeilde deadline-, DNF- en renner-al-gebruikt-regels. Daarom is de policy verwijderd; schrijven kan uitsluitend via:

- **`submit_pick(stage_id, rider_id)`** — handhaaft: renner niet al gebruikt in de competitie; renner niet DNF (`riders.dnf` óf een `stage_results.dnf` in dezelfde competitie); als er `stage_riders`-rijen bestaan moet de renner op díe startlijst staan (klassiekers); te laat (`now() > deadline OR locked`) → pick wordt opgeslagen met `is_late=true`, wijzigen geweigerd.
- **`withdraw_pick(stage_id)`** (070) — geweigerd na deadline/lock. Bestaat omdat picks bewust geen delete-policy heeft.
- **`assign_random_riders(stage_id)`** — het Rad: random renner die tot de competitie behoort, niet-DNF, niet al gebruikt door die speler; `is_random=true`.
- **`admin_upsert_pick` / `admin_delete_pick`** — checkt `profiles.is_admin` van de caller; werkt ook op locked stages.

Leidende definities: **migratie 077** (voegt audit-logging toe via `set_config('audit.source', ...)` + trigger `log_pick_change` → `pick_audit_log`). Wijzig je een pick-RPC: herdefinieer vanuit 077, niet vanuit een oudere versie.

## Profiles-guard-trigger (073)

`guard_profile_privileges()` — `BEFORE UPDATE`-trigger die wijziging van `is_admin`, `is_ai` of `email` blokkeert als de caller geen admin is. De conditie `auth.uid() IS NOT NULL` laat service-role/cron bewust passeren. Aanleiding: privilege-escalatie — de update-policy uit 001 had geen kolomrestrictie, dus een speler kon eigen `is_admin=true` PATCHen. **Nieuwe gevoelige profiel-kolom? Toevoegen aan deze trigger.**

## Owner-draaiende views (bewust RLS-omzeilend)

`general_classification` en `stage_picks_public` (leidend: 075) zijn gewone views zonder `security_invoker` → draaien als owner (postgres) en zien álle picks. Bewust: klassementen moeten compleet zijn. Deadline-gating zit ín de view (`WHERE s.locked OR s.deadline < now()`), niet in RLS. Zelfde patroon: `competition_pot_status` (074) exposeert `has_paid` maar niet `paid_at`.

**Valkuil bij nieuwe views**: een view op een RLS-tabel lekt standaard alles (owner-rechten). Bepaal bewust wélke kolommen en filters, zoals 074/075 doen — of zet `security_invoker=true` als de view wél RLS moet respecteren.

## Conventies

1. **`SECURITY DEFINER` ⇒ `SET search_path = public`** (060, schema-hijacking). Let op: `CREATE OR REPLACE FUNCTION` **reset de proconfig** — bij elke herdefinitie de `SET search_path` opnieuw inline meegeven (expliciet gedocumenteerd in 077).
2. **Admin-check in RPC's**: `SELECT is_admin FROM profiles WHERE id = auth.uid()` → `RAISE EXCEPTION 'Admin rechten vereist'`. In policies: `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)`.
3. **Edge functions** gebruiken de service-role key (omzeilen RLS); hun grens is het cron-secret of een in-functie admin-check — zie skill `cron-edge-functions`.
4. **Realtime respecteert RLS**: events voor rijen die een client niet mag zien komen niet binnen. `App.svelte` buit dat uit — picks-events zonder herkenbare `user_id` zijn per definitie niet van jou.

## Checklist nieuwe tabel

RLS aanzetten → minimale SELECT-policy (publiek alleen als echt nodig) → schrijven via admin-policy óf RPC (geen brede INSERT/UPDATE-policies met alleen eigenaarschapscheck — dat was precies de picks-bug) → privékolommen? Dan basistabel dicht en een view met alleen de publieke kolommen (patroon 074).
