---
name: etappe-visuals
description: Waar de etappe-visuals vandaan komen en hoe ze getoond worden — officiële ASO/letour.fr-afbeeldingen (profiel, routekaart, interactieve ArcGIS-kaart) met PCS als fallback, het ronde-logo, en hoe je ze voor een nieuwe ronde scrapet en seedt. Gebruik dit bij een nieuwe Tour/ronde, kapotte afbeeldingen of wijzigingen aan de pick-pagina-visuals.
---

# Etappe-visuals (ASO/letour.fr + PCS-fallback)

De pick-pagina toont per etappe maximaal drie visuals via toggle-chips (Profiel / Kaart / Interactief). Rendering: `public/views/pick.ts` (blok "Etappe-visuals"), styling: `.stage-visual-tabs`, `.stage-profile-img`, `.stage-route-frame` in `public/style.css`.

## De kolommen op `stages`

| Kolom | Bron | Wie schrijft |
|---|---|---|
| `official_profile_image_url` | letour.fr → `img.aso.fr` profiel-jpg (migratie 065) | handmatig geseed — **geen enkele sync raakt dit aan** |
| `route_map_url` | letour.fr → `img.aso.fr` statische kaart ("cartepot") | idem |
| `interactive_map_url` | letour.fr → ArcGIS instant app (migratie 067) | idem |
| `profile_image_url` | PCS-scrape | `sync-pcs-race` + auto-sync ververst bij elke run |

Voorrang in de UI: officieel profiel → PCS-profiel (via `data-fb`/`onerror`-keten). De interactieve kaart is een **lazy iframe**: `data-src` wordt pas naar `src` gekopieerd bij eerste klik op de tab (ArcGIS is zwaar).

## Nieuwe ronde seeden — scrape-recept

De URLs staan per etappe op `https://www.letour.fr/en/stage-N` (of het equivalent van de ASO-koers). Cloudflare/letour blokkeert dit niet voor fetch **vanuit een browsercontext** — gebruik Playwright, navigeer één keer naar de site en fetch de rest in-page:

- **Profiel**: regex `https://img\.aso\.fr/core_app/img-cycling-tdf-[a-z]+/[^"' ]*profil[^"' ]*`
- **Statische kaart**: idem met `(?:carte|map|parcour)` — heet meestal `…-cartepot-…`
- **Interactief**: `https://amaurysport\.maps\.arcgis\.com/apps/instant/basic/index\.html\?appid=[a-f0-9]+` (uniek appid per etappe)

Daarna met één `UPDATE … FROM (values …)` per kolom seeden via `supabase db query --linked` (match op `stage_number` + `competition_id`).

Hotlinken van `img.aso.fr` en embedden van de ArcGIS-app werkt (getest juli 2026: geen referer-check, geen `X-Frame-Options`/`frame-ancestors`).

## Ronde-logo

`competitions.logo_url` (migratie 066), optioneel. Getoond in de navbar naast de ronde-kiezer (`#comp-logo`, gezet in `helpers.ts → applyCompColor`). Invoerveld in de admin-competitietabel. De `.comp-logo`-CSS geeft een **witte chip-achtergrond** — officiële logo's zijn vaak donker-op-transparant en anders onzichtbaar op de donkere navbar. TdF: `https://www.letour.fr/img/global/logo@2x.png`.

## Valkuilen

- **PCS her-shardt afbeeldings-URLs** massaal (juli 2026: 20/21 TdF-profielen dood). Daarom ververst auto-sync `profile_image_url` uit de toch al gefetchte stagepagina, en heeft de img-tag een `onerror`-fallback. Zie ook de pcs-sync skill.
- ASO-kolommen zijn TdF-2026-specifiek geseed; een nieuwe ronde zonder seed valt automatisch terug op PCS — niets breekt.
- `stage_riders`-achtige syncs of `sync-pcs-race` mogen de drie ASO-kolommen nooit overschrijven; ze bestaan juist als sync-vrije laag.
