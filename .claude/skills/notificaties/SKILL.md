---
name: notificaties
description: Hoe notificaties werken — web push end-to-end (VAPID, RFC 8291-encryptie in _shared/webpush.ts, subscribe-flow, service worker, de vier push-versturende functies, dode-subscription-opruiming) plus lokale deadline-meldingen en de uitgeschakelde e-mail (Resend). Gebruik dit bij elke wijziging aan push, meldingsteksten, de service worker, subscriptions of het her-aanzetten van e-mail.
---

# Notificaties

Drie soorten: **web push** (server → apparaat, werkt volledig), **lokale deadline-meldingen** (client-side `Notification` API) en **e-mail** (uitgeschakeld, migratie 056).

## Web push — de keten

```
push-functie (Deno) ──sendPush()──> push-endpoint (FCM/Apple/Mozilla)
                                         │
public/sw.js 'push'-event ──showNotification()──> gebruiker
```

### Server: `supabase/functions/_shared/webpush.ts` (getest!)

VAPID RFC 8292 + encryptie RFC 8291/aes128gcm, volledig zelf geïmplementeerd. Belangrijkste exports: `importVapidPrivateKey`, `makeVapidJWT`, `encryptPayload`, `buildPushBody`, `sendPush`.

- **JWK-import-valkuil**: Deno's ring-crypto weigert minimale PKCS8 bij `sign()` met `InvalidEncoding`. Daarom import als **JWK**: `d` = private secret, `x`/`y` afgeleid uit de raw public key (P-256 punt `0x04 || x || y` → bytes 1-33 en 33-65). Niet "verbeteren" naar PKCS8.
- **`sendPush` heeft een 5s timeout** (`AbortSignal.timeout(5000)`) — één hangend endpoint mag de sequentiële verzendloop niet blokkeren.
- Succes = `res.ok || res.status === 201`.

Tests: `supabase/functions/tests/webpush.test.ts` — o.a. de **RFC 8291 Appendix A-testvector** (byte-voor-byte) en een regressietest dat de JWK-geïmporteerde key echt kan signen. Draaien: `deno test --allow-read supabase/functions/tests/`.

### VAPID-keys

- **Public key hardcoded op 5 plekken identiek**: `src/lib/config.ts` (export `VAPID_PUBLIC_KEY`) + lokale const in `auto-remind`, `auto-notify-results`, `auto-dns-check`, `test-push`. Wijzig je hem: alle vijf.
- **Private key**: secret `VAPID_PRIVATE_KEY` (`supabase secrets`). Ontbreekt hij → functie geeft 500.
- `VAPID_SUBJECT` hardcoded = de Supabase project-URL.

### Client: subscribe-flow (`src/lib/notifications.ts`)

- `subscribeNotifications()` — toggle via knop `#btn-notifications`. Aan: `requestPermission()` → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → **eerst DELETE op endpoint, dan POST** naar tabel `push_subscriptions` (`user_id, endpoint, p256dh, auth_key`) — vervangt alleen dít apparaat, andere apparaten houden hun sub. Uit: `unsubscribe()` + delete-rij.
- **iOS-detectie** (incl. iPadOS via `Macintosh` + `maxTouchPoints > 1`): niet-standalone → hint `#ios-push-hint` "Zet op beginscherm" — push werkt op iOS alléén als geïnstalleerde PWA.
- Los daarvan: `setupDeadlineNotifications()` — lokale meldingen (geen push) 30 en 5 min voor deadline zonder pick, check-interval elke 60s, tags `deadline-<id>`/`deadline-urgent-<id>`.

### Service worker: `public/sw.js`

`push`-event: `showNotification(data.title, { body, icon/badge: '/favicon.ico', data:{url} })`. `notificationclick`: focust bestaand venster (`client.navigate(url)`) of `openWindow(url)`. Payload-contract is dus `{ title, body, url }` — houd push-functies daaraan.

## De vier push-versturende functies

| Functie | Trigger | Bericht |
|---|---|---|
| `auto-remind` | cron */30, deadline over 30–90 min, geen pick | "⏰ Keuze deadline nadert" → `/#pick` |
| `auto-notify-results` | cron */10, uitslag binnen (`locked`, resultaten aanwezig) | **gepersonaliseerd** per speler |
| `auto-dns-check` | cron */30, deadline < 3u, PCS-dropout gevonden | "⚠️ <renner> stapt niet op" → `/#pick` |
| `test-push` | admin handmatig (CORS-functie) | testmelding naar eigen subs |

Personalisatie in `auto-notify-results` (`payloadForUser`): leest `stage_picks_public` (renner, positie, spelpunten, dnf/is_late/is_random) + `general_classification` (nieuwe positie); `scoring_mode === "classic"` → "het spelklassement", anders "het AK"; stage 0 heet "Proloog".

## Conventies (afdwingen bij elke wijziging)

1. **Vlag vóór de loop**: `reminder_sent`/`results_notified` worden gezet vóórdat de verzendloop start — crash halverwege geeft liever een gemiste dan een dubbele melding. `auto-dns-check` dedupliceert anders: pusht alleen renners die in díe run nieuw als dropout gemarkeerd worden.
2. **Dode subs opruimen**: bij `404 || 410` de rij op `endpoint` verwijderen uit `push_subscriptions`. Zit in alle drie de cron-loops; hoort in elke nieuwe verzendloop.
3. Nieuwe push-functie? Importeer uit `_shared/webpush.ts`, nooit kopiëren.

## E-mail (uit sinds migratie 056)

Geen eigen domein → Resend gaf 403 op elke verzending; cron `email-remind` is ge-unscheduled. Code bestaat nog: `email-remind/index.ts` (herinnering 3,5–4,5u voor deadline aan users met `profiles.email_reminders=true`, vlag `stages.email_sent`), `test-email/index.ts` (admin), `_shared/email-template.ts` (`buildReminderEmail`).

**Her-aanzetten**: (1) domein verifiëren bij Resend en `EMAIL_FROM` op dat domein zetten, (2) `RESEND_API_KEY` staat al als secret, evt. `APP_URL`, (3) cron opnieuw schedulen — de originele schedule staat in **migratie 049** (`0 * * * *`, mét `x-cron-secret` uit `_app_config`); migratie 056 verwijst naar 034 maar 049 is de feitelijke bron, (4) `#email-remind-row` in `public/index.html` weer tonen.
