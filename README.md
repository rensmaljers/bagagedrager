# Bagagedrager

Een wielerspel waarin spelers per etappe één renner kiezen en strijden om het beste klassement. Geschikt voor Tour de France, Giro d'Italia, Vuelta a España en voorjaarsklassiekers.

## Hoe werkt het?

- Elke etappe kies je **één renner**
- Elke renner mag je maar **één keer** gebruiken per competitie
- De tijd, punten en bergpunten van jouw renner worden jouw score
- **Deadline:** 23:00 de avond vóór de etappe
- Te laat? Je krijgt de tijd van de laatste renner en 0 punten

## Klassementen

| Klassement | Trui | Criteria |
|---|---|---|
| Algemeen | Geel | Laagste totale tijd |
| Punten | Groen | Meeste punten |
| Berg | Bolletjes | Meeste bergpunten |

## Tech Stack

| Component | Technologie |
|---|---|
| Frontend | Vanilla JS + Bootstrap 5 |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions) |
| Hosting | Netlify |

## Project Structuur

```
public/
├── index.html          SPA met alle pagina's
└── app.js              Frontend logica

supabase/
├── migrations/
│   ├── 001_schema.sql          Basis schema (riders, stages, picks, etc.)
│   └── 002_competitions.sql    Multi-competitie ondersteuning
├── functions/
│   ├── submit-pick/            Keuze indienen met validatie
│   ├── admin-results/          Resultaten invoeren (admin)
│   └── admin-lock-stage/       Etappes vergrendelen (cron)
└── config.toml
```

## Snel Starten

### 1. Supabase

Maak een project aan op [supabase.com](https://supabase.com) en voer de migrations uit in de SQL Editor:

```bash
# Of via CLI
supabase link --project-ref <jouw-project-ref>
supabase db push
```

### 2. Configuratie

Pas `SUPABASE_URL` en `SUPABASE_ANON_KEY` aan in `public/app.js`.

### 3. Edge Functions deployen

```bash
supabase functions deploy submit-pick
supabase functions deploy admin-results
supabase functions deploy admin-lock-stage
```

### 4. Admin instellen

```sql
UPDATE profiles SET is_admin = true WHERE display_name = 'JouwNaam';
```

### 5. Deployen

Push naar GitHub en koppel aan Netlify.

## Admin Panel

Admins hebben toegang tot:

- **Gebruikers** — Overzicht van alle spelers, admin rechten toekennen
- **Competities** — Tour, Giro, Vuelta of klassiekers aanmaken
- **Renners** — Renners toevoegen en beheren
- **Etappes** — Etappes per competitie, vergrendelen/ontgrendelen
- **Resultaten** — Tijden, punten en bergpunten invoeren per etappe

## Spelregels

- Maximaal **50 spelers** per spel
- Eén renner per etappe, elke renner **maximaal één keer** per competitie
- DNF/DNS renners: tijd van de laatste renner, behaalde punten blijven staan
- Te laat ingediende keuze: laatste tijd, 0 punten, 0 bergpunten
