# Bagagedrager — Setup

Hoe je het spel vanaf nul op een eigen Supabase + Netlify-omgeving zet. Draait het al en wil je een nieuwe ronde opzetten? Zie de skill `.claude/skills/nieuwe-competitie/`.

## 1. Supabase

### Project + migraties

1. Maak een project aan op [supabase.com](https://supabase.com)
2. `brew install supabase/tap/supabase`
3. `supabase link --project-ref <jouw-project-ref>`
4. `supabase db push` — zet het volledige schema, alle views/RPC's én de cron-schedules neer

De migraties activeren zelf de extensies `pg_cron` en `pg_net` en registreren alle cron-jobs; daar is geen handwerk voor nodig. **Let op**: de cron-job-bodies bevatten hardcoded function-URL's van het originele project — draai je op een eigen project-ref, pas die dan aan (zie `.claude/skills/cron-edge-functions/`).

### CI voor migraties (optioneel, aanbevolen)

`.github/workflows/deploy.yml` draait `supabase db push` automatisch bij elke push naar `main` die `supabase/migrations/**` raakt. Zet daarvoor de repo-secrets `SUPABASE_PROJECT_REF` en `SUPABASE_ACCESS_TOKEN`.

### Edge functions deployen

Alle browser- en cron-aangeroepen functies moeten met `--no-verify-jwt` gedeployed worden (auth gebeurt ín de functie):

```bash
for f in sync-pcs-results sync-pcs-race sync-pcs-photos auto-rad auto-sync \
         auto-dns-check auto-remind auto-notify-results cron-refresh-specialties \
         test-push test-email; do
  supabase functions deploy "$f" --no-verify-jwt --project-ref <jouw-project-ref>
done
```

### Secrets

```bash
supabase secrets list   # wat er verwacht wordt
```

- **Web push**: VAPID-keypair genereren; de public key staat hardcoded in `src/lib/config.ts`, de private key gaat als secret (JWK-import-valkuil: zie `.claude/skills/notificaties/`).
- **E-mail** (`RESEND_API_KEY`): staat uit zolang er geen eigen domein is — zie CLAUDE.md § Notificaties.

### Admin instellen

Na registratie in de app, in de SQL Editor:

```sql
UPDATE profiles SET is_admin = true WHERE display_name = 'JouwNaam';
```

## 2. Frontend

Pas `SUPABASE_URL`, `SUPABASE_ANON_KEY` en `VAPID_PUBLIC_KEY` aan in `src/lib/config.ts`.

```bash
npm install
npm run dev       # lokaal ontwikkelen
npm run build     # productie-build → dist/
```

## 3. Netlify

1. Koppel de GitHub-repo aan Netlify
2. Build-instellingen staan al in `netlify.toml`: command `npm run build`, publish `dist/`, Node 20
3. Elke push naar `main` deployt automatisch (atomisch, ~15-30s)

## 4. Data vullen

Renners, etappes en startlijsten komen niet uit seed-SQL maar uit ProCyclingStats, via de admin-flow in de app (`sync-pcs-race` importeert een complete ronde inclusief startlijst). Het volledige draaiboek — competitie aanmaken, race importeren, visuals seeden, invites, pot — staat in `.claude/skills/nieuwe-competitie/`.
