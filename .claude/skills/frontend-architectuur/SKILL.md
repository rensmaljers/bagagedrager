---
name: frontend-architectuur
description: De Svelte 5-frontend van binnen — App.svelte-shell (boot, hash-routing, realtime, thema), de $state-runes in state.svelte.ts met de verplichte appState-alias, het cache+stale-guard-patroon in de views, het {@html}-string-builder-patroon met document-delegatie, admin-lazy-loading en de service worker/build-pipeline. Gebruik dit bij elke nieuwe view, wijziging aan state/laden/realtime, of wanneer reactiviteit/caching zich vreemd gedraagt.
---

# Frontend-architectuur (Svelte 5)

Geen router-, UI- of state-library — alleen Svelte 5 runes + `@supabase/supabase-js`. Vite-entry is `public/index.html` (`vite.config.ts`: `root: 'public'`, outDir `../dist`).

## De shell: `src/App.svelte`

- **Boot**: module-scope IIFE doet `supabase.auth.getSession()`; bij sessie zet hij `appState.session`, waarna een `$effect` (met `appStarted`-guard, binnen `untrack`) `initApp()` draait. `initApp` batcht de eerste round-trip in één `Promise.all` (profiel, competities, stages, eigen picks, alle profielen, riders + `general_classification` voor de opgeslagen ronde, team_shirts).
- **Tab-routing**: hash-based, `TABS = ['dashboard','pick','history','participants','account','admin']`; `navigateToTab()` + `hashchange`-listener. Views renderen binnen `{#key ui.refreshTick}` — `ui.refreshTick++` bij ronde-wissel forceert remount.
- **Views zijn prop-loos** en laden hun eigen data bij mount. Ronde-kleur via `$derived` → CSS-vars `--comp-color`/`--comp-accent`.
- **Admin lazy**: `src/views/admin-lazy.ts` bevat alléén `export const loadAdmin = () => import('./Admin.svelte')`; App.svelte rendert via `{#await loadAdmin() then { default: Admin }}`. De `import()` mag níet direct in App.svelte — rolldown's dynamic-import-vars-plugin parseert het `.svelte`-bestand dan als JS en crasht. Niets opstart-kritieks in Admin stoppen.
- **SW-update-flow**: registratie module-scope; bij `controllerchange` een "App bijgewerkt — ververs"-toast, bewust géén auto-reload (niet midden in een pick).

## State: `src/lib/state.svelte.ts`

Twee `$state`-objecten: `state` (data: session, profile, competitions, riders, stages, myPicks, `_cache`, `_riderMap`, stageRiders, teamShirts, …) en `ui` (activeTab, loading, toast, playerModalId, riderModalId, h2hRequest, refreshTick).

**Verplichte alias**: `import { state as appState }` in elk `.svelte`-bestand — een lokale binding `state` schaduwt de `$state`-rune en de compiler leest hem dan als store-subscription. Mutatiestijl: whole-assignment (`appState.riders = [...]`); genest werkt óók reactief via de proxy — daar leunt de cache-invalidatie op.

## Het laad-patroon (elke async loader zó bouwen)

```ts
async function loadX() {
  const loadCompId = appState.activeCompId;              // 1. vastleggen
  if (appState._cache.xCompId === loadCompId && appState._cache.x) return;  // 2. cache-hit
  const data = await supaRest(...);
  if (appState.activeCompId !== loadCompId) return;      // 3. stale-guard: ronde gewisseld → niet toewijzen
  appState._cache.x = data; appState._cache.xCompId = loadCompId;
}
```

- Cache = `_cache.<x>` + `<x>CompId`-paar. **Invalidatie = `_cache.x = null`** (reactief), niet remount — een `$effect` in de view ziet de null en herlaadt zonder scroll/zoekveld te verliezen.
- `$effect`s die loaders aanroepen: reads die géén dependency mogen zijn in `untrack()`.
- Bestaande voorbeelden: `loadStandings` (Dashboard), `loadParticipants` (Peloton), `loadHistory` (History).

## Realtime (setupRealtime, App.svelte)

Eén channel `game-updates`, twee `postgres_changes`-subscriptions (`stage_results` en `picks`, event `*`). Beide nullen de caches. Picks-events: eigen `myPicks` alleen herladen als `payload.new/old.user_id === eigen id` (RLS verbergt andermans picks vóór de deadline, dus events zonder herkenbare user_id zijn niet van jou), en die fetch is **800ms gedebounced** tegen de deadline-piek. Bij re-login eerst `removeChannel` op het oude channel.

## `{@html}` + string-builders

`riderDisplay`, `avatarHtml`, `teamBadge`, `icon`, `compBadge` geven HTML-strings terug → renderen met `{@html ...}`. Niet herschrijven naar componenten. Spelregels:
- **Alle user-content door `escapeHtml`** (utils.ts) — dat is de XSS-guard van dit patroon.
- Interactiviteit kan niet ín de string: document-brede delegatie in App.svelte (`<svelte:document>`) vangt clicks/keys op `.rider-click[data-rider-id]` (→ `ui.riderModalId`) en hover op `.rider-photo`/`.avatar` (foto-preview).
- Tooltips: `.info-tooltip[data-tip]` — de engine is een inline IIFE in `public/index.html`.

## Modals

`use:focusTrap` (`src/lib/focus-trap.ts`) + `role="dialog" aria-modal="true" aria-label="..."`. De action focust het eerste focusable element, wrapt Tab, en zet focus terug bij sluiten. Geopend via `ui`-state (`playerModalId`/`riderModalId`); PlayerModal/RiderModal staan app-breed onderaan App.svelte.

## API-laag: `src/lib/api.ts`

Thin PostgREST-wrappers: `supaRest(table, {method, filters, body, select})`, `supaPatch`, `supaDelete`, `supaUpsert`, en `supaRpc` (voor `submit_pick`/`withdraw_pick` e.d.). Geen load-functies hier — die leven in de views.

## Build & first paint

- `npm run build` = svelte-check (**0-baseline, gate**) → Vite → kopieert `sw.js`/manifest/iconen handmatig naar `dist/` (staan buiten Vite's pipeline). `npm run typecheck` = tsc over `src/**`, 0 errors houden.
- **First-paint-regel**: alles wat vóór de eerste paint zichtbaar is (body-bg, thema, loader, nav) staat inline in `public/index.html` (kritieke CSS + blocking theme-script) — wijzig het dáár én in `public/style.css`. Fonts self-hosted met preload; geen CDN.
- Service worker `public/sw.js`: `/assets/` + `/fonts/` cache-first (immutable hashes), navigaties network-first met shell-fallback; Supabase/PCS-requests worden niet geïntercept. `/assets/` is gecapt op 24 entries (oudste eruit — Cache.keys() is insertion-order; fonts blijven staan) zodat oude deploy-bundles zich niet eeuwig opstapelen.
- **Node ≥ 22 lokaal** (`.nvmrc`) — Vite 8/rolldown eist `^20.19 || >=22.12`; op oudere Node faalt de build met `ERR_REQUIRE_ESM`. Zie je "Cannot find native binding", dan is het de npm-optional-deps-bug: `npm install --no-save @rolldown/binding-darwin-arm64@<rolldown-versie>`.

## Checklist nieuwe view

Prop-loze `.svelte` in `src/views/` → tab in `TABS` + markup-tak in App.svelte → loader met cache+stale-guard-patroon → `import { state as appState }` → user-content escapen → verifiëren via skill `verify`.
