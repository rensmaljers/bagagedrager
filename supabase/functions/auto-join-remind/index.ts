import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importVapidPrivateKey, sendPush } from "../_shared/webpush.ts";
import { buildJoinPayload, decideJoinPush, firstDeadline } from "../_shared/join-remind.ts";

// Draait elk uur (cron, migratie 20261021120000_join_remind). Inschrijf-pushes per
// actieve, nog niet gestarte ronde (beslislogica in _shared/join-remind.ts):
//   - "Inschrijving geopend" — eenmalig zodra de ronde actief is en etappes heeft
//   - "Laatste kans"         — eenmalig binnen 24 uur vóór de start
// Alleen naar actieve, niet-AI spelers die nog níet ingeschreven zijn.
// Aanleiding: Tour of Guangxi 2026 — inschrijven was nieuw en maar 1 speler deed mee.

const VAPID_PUBLIC_KEY = "BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ";
const VAPID_SUBJECT = "https://hdkvirtytljnuawcmoui.supabase.co";

Deno.serve(async (req: Request) => {
  const { data: expectedSecret } = await createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  ).rpc("get_cron_secret");
  if (!expectedSecret || req.headers.get("x-cron-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const vapidPrivateKeyRaw = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKeyRaw) {
    return new Response(JSON.stringify({ error: "VAPID_PRIVATE_KEY niet ingesteld" }), { status: 500 });
  }

  const { data: comps, error } = await supabase
    .from("competitions")
    .select("id, name, is_active, join_open_notified_at, join_reminder_sent_at")
    .eq("is_active", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!comps?.length) return new Response(JSON.stringify({ results: [], message: "Geen actieve rondes" }));

  const now = new Date();
  const results: any[] = [];
  let privateKey: CryptoKey | null = null;

  for (const comp of comps) {
    const { data: stages } = await supabase
      .from("stages")
      .select("deadline, locked")
      .eq("competition_id", comp.id);

    const kind = decideJoinPush(comp, stages || [], now);
    if (!kind) { results.push({ competition_id: comp.id, skipped: true }); continue; }
    const start = firstDeadline(stages || [])!;

    // Vlag(gen) VÓÓR de verzendloop: liever een gemiste dan een dubbele melding.
    // Bij "reminder" ook de open-vlag zetten (activering binnen het venster).
    const flags = kind === "open"
      ? { join_open_notified_at: now.toISOString() }
      : { join_reminder_sent_at: now.toISOString(), join_open_notified_at: comp.join_open_notified_at || now.toISOString() };
    await supabase.from("competitions").update(flags).eq("id", comp.id);

    // Ontvangers: actieve, niet-AI spelers die nog niet ingeschreven zijn
    const [{ data: profiles }, { data: participants }] = await Promise.all([
      supabase.from("profiles").select("id").eq("is_active", true).eq("is_ai", false),
      supabase.from("competition_participants").select("user_id").eq("competition_id", comp.id),
    ]);
    const joined = new Set((participants || []).map((p: any) => p.user_id));
    const targetIds = (profiles || []).map((p: any) => p.id).filter((id: string) => !joined.has(id));
    if (!targetIds.length) { results.push({ competition_id: comp.id, kind, sent: 0, reason: "iedereen ingeschreven" }); continue; }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", targetIds);
    if (!subscriptions?.length) { results.push({ competition_id: comp.id, kind, sent: 0, reason: "Geen subscriptions" }); continue; }

    privateKey ??= await importVapidPrivateKey(vapidPrivateKeyRaw, VAPID_PUBLIC_KEY);
    const payload = buildJoinPayload(kind, comp.name, start);

    let sent = 0;
    const statuses: (number | string)[] = [];
    for (const sub of subscriptions) {
      try {
        const res = await sendPush(sub.endpoint, sub, payload, privateKey, VAPID_PUBLIC_KEY, VAPID_SUBJECT);
        statuses.push(res.status);
        if (res.ok || res.status === 201) {
          sent++;
        } else if (res.status === 404 || res.status === 410) {
          // Subscription verlopen — opruimen
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      } catch (e) {
        statuses.push((e as Error).message);
      }
    }
    results.push({ competition_id: comp.id, kind, recipients: targetIds.length, sent, statuses });
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
