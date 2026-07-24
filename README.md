# Bagagedrager — Het Wielerspel

Een fantasy-wielerspel waarin spelers per etappe **één renner** kiezen en strijden om vier klassementen. Geschikt voor grote rondes (Tour, Giro, Vuelta) én voorjaarsklassiekers.

**Live**: [bagagedrager.netlify.app](https://bagagedrager.netlify.app)

## Hoe werkt het?

- Elke etappe kies je **één renner**, vóór de starttijd van de etappe (deadline = starttijd)
- Elke renner mag je maar **één keer** gebruiken per competitie
- De tijd, sprintpunten en bergpunten van jouw renner worden jouw score; bonificatieseconden tellen mee in het algemeen klassement
- **Te laat of geen keuze?** Het Rad van Fortuin wijst een willekeurige ongebruikte renner toe. Als tijdstraf krijg je het slechtste tijdverschil van een door spelers gekozen renner die finishte (het Rad telt niet mee)
- **DNF/DNS/OTL**: dezelfde tijdstraf, 0 punten in de overige klassementen — ook punten die de renner eerder in de etappe pakte (bijv. een bergpunt op de eerste klim) vervallen als hij uitvalt; alleen finishers leveren punten op
- Klassiekers: één competitie met meerdere koersen en per-koers startlijsten

## Klassementen

| Klassement | Trui | Criteria |
|---|---|---|
| Algemeen | Geel | Laagste totale tijd (tijdverschillen minus bonificaties) |
| Punten | Groen | Meeste sprintpunten |
| Berg | Bolletjes | Meeste bergpunten |
| Spel | Wit | Punten naar aankomstpositie (1e=100 … 20e=5), met deelfactor als meerdere spelers dezelfde renner kozen |

## Tech stack

| Component | Technologie |
|---|---|
| Frontend | Svelte 5 (runes) + TypeScript, eigen CSS-design-system, Vite |
| Backend | Supabase (PostgreSQL + RLS + Edge Functions + Auth + pg_cron) |
| Hosting | Netlify (auto-deploy bij push naar `main`) |
| Data | ProCyclingStats-scraping (resultaten, startlijsten, renner-data) |
| Notificaties | Web push (VAPID), ook op iOS als geïnstalleerde PWA |

## Projectstructuur

```
public/            Mount-punt (index.html), design system (style.css), service worker, PWA-assets
src/
├── App.svelte     Shell: auth, navbar, hash-routing, realtime
├── lib/           State ($state-runes), api, supabase-client, notificaties, helpers
└── views/         Dashboard, Pick, History, Peloton, Admin (lazy), Account, modals
supabase/
├── migrations/    Al het schema én de business-logica (views, RPC's, cron-schedules)
└── functions/     Edge functions: PCS-sync, Rad van Fortuin, push-crons (+ _shared/ en tests/)
.claude/           Claude Code-setup: 12 projectskills, agents, settings, hooks
```

## Automatisering

Alles draait vanzelf via pg_cron + edge functions: etappes locken op de deadline, het Rad van Fortuin voor te late spelers, uitslagen syncen (~20 min na de finish, met vangnet-passes), herinnerings- en uitslag-pushmeldingen, een niet-starters-check vlak voor de start en een wekelijkse refresh van renner-data.

## Ontwikkelen

```bash
npm run dev         # Vite dev-server
npm run build       # svelte-check (0-errors-gate) → Vite → dist/
npm run typecheck   # tsc over src/**
deno test --allow-read supabase/functions/tests/   # PCS-parser + web push-tests
```

Installatie en deployment: zie [SETUP.md](SETUP.md). Architectuur en werkwijze per domein: zie [CLAUDE.md](CLAUDE.md) en de skills in `.claude/skills/`.
