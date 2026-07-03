# Svelte 5-migratie (branch `svelte-migratie` — NIET naar main mergen zonder akkoord)

Stap 4 van het tech-stack-plan. Doel: de vanilla-TS UI (`public/app.ts` + `public/views/*`)
naar Svelte 5-componenten, met behoud van álle functionaliteit, styling en de Supabase-laag.
**Main blijft onaangeraakt tot expliciet akkoord** — Netlify deployt alleen main.

## Architectuur

```
public/index.html      — slankt af tot mount-punt + inline kritieke CSS + fonts + theme-script
src/main.ts            — mount(App)
src/App.svelte         — shell: auth-scherm ↔ app, navbar, tab-routing, realtime, account-modal
src/lib/state.svelte.ts— gedeelde reactieve state ($state runes) + ui-state (activeTab enz.)
src/lib/*.ts           — api/config/utils/icons/helpers/supabase-client/notifications (geport uit public/)
src/views/*.svelte     — Dashboard / Pick / History / Peloton / Admin (lazy) / Account
public/style.css       — ongewijzigd; geïmporteerd in main.ts. Componenten gebruiken DEZELFDE klassen.
```

## Regels voor het porten

1. **Gedrag 1-op-1** — geen features toevoegen/weglaten. HTML-structuur en CSS-klassen exact
   overnemen uit index.html/de view-module, anders breekt style.css.
2. **Geen `$('id')`-DOM-manipulatie** in componenten — vervang door Svelte-bindings en
   `{#if}/{#each}`-markup. `utils.$` bestaat alleen nog voor legacy-code.
3. HTML-string-helpers (`teamBadge`, `avatarHtml`, `riderDisplay`, `icon`, `skeletonRows`)
   blijven strings → render met `{@html ...}`. Niet herschrijven.
4. `state` uit `../lib/state.svelte` — muteer direct (`state.riders = x`), runes doen de rest.
   Tab-wissel = `ui.activeTab = 'pick'`, geen DOM-classes.
5. `window.x = ...`-registraties (inline onclick uit templates) vervangen door echte
   event handlers in de component.
6. Data-laden: de `load*`-functies uit de views worden component-functies; aanroepen in
   `$effect` bij tabwissel of via export voor App.svelte. Caches in `state._cache` behouden.
7. **Svelte 5-syntax**: runes (`$state`, `$derived`, `$effect`), `onclick={...}` (geen `on:click`),
   `mount()` uit 'svelte' in main.ts. Geen stores/`$:`-legacy.
8. Admin blijft **lazy**: `{#await import('./Admin.svelte')}` bij eerste opening van de tab.
9. Realtime, notifications en auth-flows: logica uit app.ts overnemen, alleen de
   DOM-koppelstukken vervangen.

## Status — VOORBEREID, NIET LIVE

- [x] Scaffold: vite-plugin-svelte 7 + Vite 8, svelte.config.mjs, state.svelte.ts
- [x] src/lib-modules geport (imports omgezet)
- [x] App.svelte (shell + auth + account + realtime + hash-routing)
- [x] Dashboard.svelte (incl. H2H reactief, prijzenpot, rank-delta's)
- [x] Pick.svelte (incl. visuals-tabs, match-chips, admin-voorvertoning, pick-bar)
- [x] History.svelte + Peloton.svelte
- [x] Admin.svelte (lazy chunk, ~69KB apart)
- [x] index.html afgeslankt (921 → ~72 regels), main.ts mount
- [x] `npm run build` groen + lokaal getest: preview + Playwright, ingelogd met
      AI-account — auth, dashboard, pick, historie, uitslagen, account allemaal
      werkend, 0 console errors
- [x] `npm run check` (svelte-check): src/ schoon; 56 errors = bestaande
      baseline in legacy public/ (verdwijnt bij merge-cleanup)

### Valkuilen die tijdens de bouw gevonden zijn

- **Oud `vite.config.js` schaduwde `vite.config.ts`** (Vite pakt .js eerst) —
  de Svelte-plugin leek daardoor kapot ("HTML comments are not allowed in
  modules"). Verwijderd. Bij zulke fouten: check `resolveConfig` welke
  configFile geladen wordt.
- **`import { state }` breekt de `$state`-rune** in .svelte-bestanden (compiler
  ziet `$state` als store-subscription op de import) — overal
  `import { state as appState }`.
- Dynamic `import()` staat in `src/views/admin-lazy.ts`, niet in App.svelte
  (rolldown parseert .svelte met `import(` anders als JS).

## Livegang (pas na akkoord, ná de Tour of in een rustig venster)

1. Branch mergen naar main → Netlify bouwt automatisch.
2. `public/app.ts`, `public/views/`, `public/state.ts` verwijderen in dezelfde merge.
3. Realtime + push + picks flow live verifiëren met een testaccount.
