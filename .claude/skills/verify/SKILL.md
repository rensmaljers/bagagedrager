---
name: verify
description: End-to-end verificatie van de app in de browser — build, preview, inloggen met het testaccount en flows doorlopen met Playwright. Gebruik bij elke verificatie van frontend-wijzigingen.
---

# App verifiëren (browser, end-to-end)

## Handle

```bash
npm run build          # svelte-check draait mee als build-gate
npm run preview        # serveert dist/ op http://localhost:4173 (run_in_background)
```

Playwright MCP → `browser_navigate` naar `http://localhost:4173`. **Cache-buster
gebruiken** (`/?v=N`) na elke rebuild — de service worker + browser cachen de
gehashte assets agressief. Betrouwbaarder: aan het begin van de eval-sessie de
SW + caches wissen, dan pas inloggen:
```js
const regs = await navigator.serviceWorker.getRegistrations();
for (const r of regs) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```

## Testaccount (productie-Supabase!)

`maljers.rens+claude@gmail.com` / `hC3jLFr+nz60Ju2zSRy6gONp` — speler
"Col de Claude 🤖" (user_id `10b0720b-0695-476c-84d1-388aec8348ea`).

- Injectie via evaluate: native value-setter + `input`-event, dan
  `#auth-form.requestSubmit()`. 3,5s wachten op initApp.
- **Picks muteren mag** (eigen testaccount) maar zet ze terug — het klassement
  is publiek zichtbaar voor echte spelers.
- Admin testen: `update profiles set is_admin=true where id='10b0...'` via
  `supabase db query --linked`, en **direct daarna terugzetten**.

## Valkuilen (kostten eerder tijd)

- `.theme-toggle` matcht TWEE knoppen: `#btn-refresh` (verborgen pwa-only,
  doet `location.reload()` → "execution context destroyed") en `#btn-theme`
  (de echte). Altijd `#btn-theme` gebruiken.
- Er zijn twee `.h2h-overlay`s (admin-picks + h2h); `querySelector` pakt de
  verkeerde. Op inhoud checken (`.h2h-stat`, `.pm-head`).
- Zoekveld-state blijft staan tussen evaluates — reset met `setVal('', ...)`
  vóór een volgende kaart-telling.
- Thema wisselen zonder knop: `localStorage.setItem('bagagedrager_theme',
  'dark')` + reload.
- ArcGIS-iframe (interactieve kaart) spuwt eigen console-warnings — negeren.

## Flows die het verschil maken

Auth (fout wachtwoord → NL-melding), dashboard (expand, H2H + Escape,
PlayerModal), pick (etappe-nav, visuals-tabs, filters, pick wijzigen mét
"vervangt"-label, Verwijder-knop), history (RiderModal via renner-klik),
uitslagen (peloton-tabel), account, mobiel 390px (géén horizontale
body-scroll), `#onzin`-hash → valt terug op dashboard.

Pre-koers is verwacht gedrag: lege uitslag-tabellen, history-stats verborgen
(pas mét resultaten), score-balkjes onzichtbaar (alles 0).
