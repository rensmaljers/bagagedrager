---
name: gezondheidscheck
description: Productie-gezondheidscheck van het wielerspel — een runbook dat mislukte cron-runs, edge-function-fouten, etappes zonder Rad of uitslag na de deadline en de bereikbaarheid van de site controleert en samenvat in groen/oranje/rood. Gebruik bij "werkt alles nog?", als dagelijkse check tijdens een ronde, na een riskante deploy of wanneer spelers problemen melden.
---

# Gezondheidscheck productie

Doorloop de stappen in volgorde en sluit af met een kort rapport per onderdeel: 🟢 in orde / 🟠 aandacht / 🔴 kapot. Meld bij 🟠/🔴 óók de vermoedelijke oorzaak en de relevante skill (`cron-edge-functions`, `pcs-sync`, `notificaties`).

## 1. Cron-runs (afgelopen 24 uur)

```bash
supabase db query "select j.jobname, d.status, left(d.return_message, 120) as msg, d.start_time from cron.job_run_details d join cron.job j using (jobid) where d.status <> 'succeeded' and d.start_time > now() - interval '24 hours' order by d.start_time desc limit 10" --linked
```

Leeg = 🟢. Let op: `job_run_details` bevat maar 7 dagen historie (purge, migratie 080). "Succeeded" betekent alleen dat de HTTP-call verstuurd is — de functie-respons check je in stap 2.

## 2. Edge-function-antwoorden

```bash
supabase db query "select status_code, left(content, 150) as body, created from net._http_response where created > now() - interval '24 hours' and (status_code is null or status_code >= 300) order by created desc limit 10" --linked
```

- `401` → cron-secret-mismatch of functie zonder `--no-verify-jwt` gedeployed (skill `cron-edge-functions`).
- `500` met PCS-context → parser/HTML-wijziging (skill `pcs-sync`).
- `status_code is null` → timeout van pg_net.

## 3. Spelstatus: Rad en uitslagen

Verlopen deadlines zonder Rad-toewijzing (moet binnen ~15 min na deadline gebeuren):

```bash
supabase db query "select id, name, deadline from stages where deadline < now() and deadline > now() - interval '7 days' and not rad_assigned order by deadline desc" --linked
```

Gefinishte etappes zonder uitslag (auto-sync-eta hoort ~20 min na de finish te syncen; vangnetten om 9:00/16:00 UTC):

```bash
supabase db query "select s.id, s.name, s.estimated_end_time from stages s where s.estimated_end_time < now() - interval '2 hours' and s.estimated_end_time > now() - interval '7 days' and not exists (select 1 from stage_results r where r.stage_id = s.id) order by s.estimated_end_time desc" --linked
```

Beide leeg = 🟢. Een etappe van vandaag zonder uitslag ná het vangnet-uur = 🔴 → sync handmatig triggeren (skill `pcs-sync`).

## 4. Site bereikbaar

```bash
curl -sI https://bagagedrager.netlify.app | head -1
```

`HTTP/2 200` = 🟢. Anders: Netlify-deploy-status checken (laatste push naar `main` brak mogelijk de build — de svelte-check-gate in `npm run build` faalde dan al lokaal).

## 5. Rapport

Vat samen per onderdeel (crons / edge functions / spelstatus / site) met het stoplicht, en noem bij afwijkingen de eerstvolgende concrete actie. Niets zelf "repareren" in productie zonder het eerst te melden — dit runbook is diagnose, geen ingreep.
