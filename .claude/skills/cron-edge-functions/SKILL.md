---
name: cron-edge-functions
description: De cron- en edge-function-laag — alle 13 functies en hun rol, de twee auth-patronen (x-cron-secret via _app_config vs. CORS+admin-check in de functie), waar elke cron-schedule gedefinieerd is (leidende migratie per job), deploy met --no-verify-jwt en de debug-recepten (cron.job_run_details, net._http_response). Gebruik dit bij elke nieuwe/gewijzigde edge function, cron-job, schedule-aanpassing of wanneer een cron niet lijkt te draaien.
---

# Cron & edge functions

Twee categorieën functies, twee auth-patronen. Kies bij een nieuwe functie eerst de categorie — de rest volgt.

## Categorie 1: cron-aangeroepen (x-cron-secret)

`auto-rad`, `auto-sync`, `auto-remind`, `auto-notify-results`, `auto-dns-check`, `cron-refresh-specialties`, `email-remind` (cron uit).

Auth-patroon (bovenin elke functie):
```ts
const { data: expectedSecret } = await adminClient.rpc("get_cron_secret");
if (!expectedSecret || req.headers.get("x-cron-secret") !== expectedSecret) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
}
```

Het secret leeft in tabel `_app_config` (key `cron_secret`, migratie 042; `REVOKE ALL FROM anon, authenticated`). Cron-jobs sturen het mee via `(SELECT value FROM _app_config WHERE key = 'cron_secret')`. Migratie 041 (`current_setting('app.cron_secret')`) is de kapotte voorloper — negeren, 042 is leidend.

Deze functies gebruiken de **service-role key** en omzeilen RLS volledig; het cron-secret is de enige grens.

## Categorie 2: browser-aangeroepen (CORS + admin-check)

`sync-pcs-results`, `sync-pcs-race`, `sync-pcs-photos`, `test-push`, `test-email`.

Vast patroon:
```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Authorization → auth.getUser() → adminClient checkt profiles.is_admin → 403
```

Waarom `verify_jwt = false`: de CORS-preflight (en cron-calls) kunnen geen JWT dragen — Supabase zou 401 geven vóór de functie draait. Auth gebeurt daarom ín de functie. **Alle 11 actieve functies staan met `verify_jwt = false` in `supabase/config.toml`** én moeten met `--no-verify-jwt` gedeployed worden:

```bash
supabase functions deploy <naam> --no-verify-jwt --project-ref hdkvirtytljnuawcmoui
```

## Cron-jobs — leidende migratie per job

Schedules worden herhaaldelijk aangepast; de **hoogst genummerde migratie met `cron.schedule('<jobnaam>', ...)` wint**. `cron.schedule()` met bestaande jobname updatet in place (geen unschedule nodig — zie header migratie 079).

| Job | Schedule | Leidend | Bijzonderheid |
|---|---|---|---|
| `auto-rad` | */15 | 079 | daarna `rad_assigned=true` per stage |
| `auto-lock-stages` | */15 | 079 | **pure SQL UPDATE**, geen edge function |
| `auto-notify-results` | */15 | 079 | |
| `auto-remind` | */30 | 060 | |
| `auto-sync-ochtend` / `-middag` | 9:00 / 16:00 UTC | 060 | body `{}` = alle etappes vandaag |
| `auto-sync-eta` | */15 | 072 | body `{"mode":"eta"}` — synct pas na `estimated_end_time`+20 min |
| `auto-dns-check` | */30 | 072 | |
| `weekly-rider-specialty-refresh` | ma 3:00 UTC | 042 | → `cron-refresh-specialties` |
| `purge-cron-job-run-details` | 4:00 UTC | 080 | houdt 7 dagen `cron.job_run_details` |
| `email-remind` | **uit** | 056 (unschedule) | origineel in 049 |

079/080 bestaan omdat */10-crons het Disk IO Budget opvraten en `job_run_details` ongelimiteerd groeide — nieuwe crons niet strakker dan */15 zonder reden, en bedenk dat de purge op 7 dagen staat.

Function-URL's zijn hardcoded in de job-bodies: `https://hdkvirtytljnuawcmoui.supabase.co/functions/v1/<functie>`. Extensies: pg_net + pg_cron (migratie 041).

## Vlag-conventie (dubbele meldingen voorkomen)

Push-crons zetten hun "verzonden"-vlag op `stages` (`reminder_sent`, `results_notified`) **vóór** de verzendloop — crash halverwege geeft liever een gemiste dan een dubbele melding bij de volgende run. `auto-notify-results` zet de vlag ook op vroege `continue`-paden. `auto-rad` zet `rad_assigned` juist ná de RPC (geen push-loop, geen dubbel-risico). Nieuwe cron met notificaties → zelfde conventie.

## Valkuilen

- **Nooit importeren uit een andere functie-map** — de top-level `Deno.serve` van die functie kaapt dan alle requests. Gedeelde code hoort in `_shared/`.
- VAPID private key als **JWK** importeren (zie skill `notificaties`) — PKCS8 faalt met `InvalidEncoding`.
- Nieuwe browser-functie? Vergeet niet: CORS-blok + OPTIONS-handler + `verify_jwt = false` in `config.toml` + deploy met `--no-verify-jwt`.
- SECURITY DEFINER-functies in migraties: altijd `SET search_path = public`.

## Debuggen

```bash
# Draaide de cron, en wat zei hij?
supabase db query "select * from cron.job_run_details order by start_time desc limit 5" --linked
# Wat antwoordde de edge function op de pg_net-call?
supabase db query "select status_code, left(content,200), created from net._http_response order by created desc limit 5" --linked
# Alle jobs + schedules
supabase db query "select jobname, schedule, active from cron.job" --linked
```

Typische oorzaken "cron draait niet": vlag stond al op true (check de stage-rij), 401 in `net._http_response` (secret-mismatch), of functie gedeployed zonder `--no-verify-jwt`.
