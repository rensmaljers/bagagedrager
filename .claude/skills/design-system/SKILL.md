---
name: design-system
description: Het visuele systeem van de app — design-tokens in style.css (dark + light), het trui-systeem (geel/groen/bolletjes/wit als klassement-identiteit), typografie (Clash Display + Satoshi, tabulaire cijfers) en de regels om nieuwe UI consistent te houden. Gebruik dit bij elke styling-wijziging, nieuw UI-component, kleurkeuze of thema-werk.
---

# Design system

Eén design system, volledig in `public/style.css` (secties: Tokens → Base → Layout → Components → Views → Motion → Responsive). Kritieke first-paint-CSS staat daarnaast **inline in `public/index.html`** — wijzig je iets dat vóór de eerste paint zichtbaar is (body-achtergrond, nav, thema), pas dan béide plekken aan.

## Tokens — altijd tokens, nooit losse hex

Alle kleuren/geometrie/motion als CSS custom properties op `:root, [data-theme="dark"]` met een volledige override in `[data-theme="light"]`. **Elke nieuwe token moet in beide blokken** — een token die alleen dark bestaat lekt donkere kleuren naar light mode.

- Surfaces gelaagd: `--bg` < `--bg-card` < `--bg-elevated`; randen `--border` / `--border-strong`.
- Brand: `--accent` (goud/geel) + `-hover/-text/-dim/-bg` varianten.
- Functioneel: `--green/--red/--blue/--purple` elk met `-dim`.
- Geometrie/depth: `--radius`, `--radius-lg`, `--shadow-sm/md/lg`. Motion: `--ease`, `--dur`.

Thema wisselt via `data-theme` op de root (theme-script inline in index.html).

## Trui-systeem — klassement = trui

De vier klassementen dragen hun echte wielertrui als structurele identiteit:

| Klassement | Trui | Tokens |
|---|---|---|
| GC | geel | `--jaune`, `--jaune-ink`, `--jaune-glow` |
| Punten | groen | `--vert`, `--vert-ink`, `--vert-glow` |
| Berg | bolletjes (rood) | `--pois`, `--pois-ink`, `--pois-glow` |
| Spel | wit | `--wit`, `--wit-edge`, `--wit-ink`, `--wit-glow` |

- `-ink` = tekstkleur óp de truikleur (chips), `-glow` = subtiele gloed/tint eromheen. Wit-trui heeft extra `--wit-edge` omdat wit op een lichte achtergrond geen rand geeft.
- **Patroon**: componenten krijgen een klasse `jersey-gc|jersey-points|jersey-mountain|jersey-game` die lokaal `--jcol`/`--jglow` zet; de generieke regel (`[class*="jersey-"]`) doet de rest. Nieuw klassement-gebonden component? Volg dit patroon, geen aparte per-klassement regels.
- Toegepast op: kaartheaders (truikleur-rand + tint + gekleurd icoon), standen (leider "draagt de trui": rand, gloed, display-cijfer, `trui-chip` naast de naam), jouw-koers-strip (truikleur-stip; berg = mini-bolletjes).
- Zachtere achtergrond-tinten voor hero's/feature-iconen: `--jersey-gc-bg` e.d.

## Typografie

- Basisfont: **Satoshi** (alles). Display-face: **Clash Display** (`--font-display`) — alleen voor paginatitels en grote koers-cijfers, via de `.display`-klasse of expliciete `font-family: var(--font-display)`.
- Fonts via Fontshare, **async geladen** (media-swap in index.html) — first paint hangt alleen op systeemfont + inline CSS. Nieuwe gewichten toevoegen = de Fontshare-URL op twee plekken in index.html (link + noscript).
- **Alle uitslag-/klassementdata in tabulaire cijfers**: `.tnum` of `font-variant-numeric: tabular-nums` — anders dansen kolommen bij live-updates.

## Werkwijze bij UI-werk

- Mockups eerst in `.claude/design-mockup/` (losse HTML met dezelfde tokens), dan pas in de app.
- Geen emoji's in de UI (bewust verwijderd in de UI-craft pass) — iconen zijn SVG/CSS.
- Test elke wijziging in dark én light (thema-toggle) — de light-overrides zijn handmatig gebalanceerd (accent is daar donkerder goud voor contrast).
- Micro-animaties via `--ease`/`--dur`; respecteer bestaande motion-sectie, geen ad-hoc transitions.
