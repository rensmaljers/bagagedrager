import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importVapidPrivateKey, sendPush } from "../_shared/webpush.ts";

// Draait elke 10 minuten (cron, zie migratie 068).
// Stuurt een push naar alle deelnemers van een competitie zodra de uitslag van
// een etappe binnen is: stage_results aanwezig + etappe gelockt + nog niet
// genotificeerd. De results_notified-vlag voorkomt dubbele meldingen.

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
  const privateKey = await importVapidPrivateKey(vapidPrivateKeyRaw, VAPID_PUBLIC_KEY);

  // Recent gelockte etappes zonder melding; alleen laatste 3 dagen zodat een
  // handmatige import van oude uitslagen geen meldingen-lawine geeft.
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, name, competition_id, competitions(name)")
    .eq("results_notified", false)
    .eq("locked", true)
    .gt("start_time", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!stages?.length) return new Response(JSON.stringify({ notified: 0 }));

  const results = [];

  for (const stage of stages) {
    // Alleen melden als er daadwerkelijk een uitslag staat
    const { count: resultCount } = await supabase
      .from("stage_results")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stage.id);
    if (!resultCount) {
      results.push({ stage_id: stage.id, skipped: "geen uitslag" });
      continue;
    }

    // Deelnemers: iedereen met ≥1 pick in deze competitie (zelfde definitie als auto-remind)
    const { data: compPicks } = await supabase
      .from("picks")
      .select("user_id, stages!inner(competition_id)")
      .eq("stages.competition_id", stage.competition_id);
    const participantIds = [...new Set((compPicks || []).map((p: any) => p.user_id))];

    if (!participantIds.length) {
      await supabase.from("stages").update({ results_notified: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, notified: 0, reason: "geen deelnemers" });
      continue;
    }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", participantIds);

    if (!subscriptions?.length) {
      await supabase.from("stages").update({ results_notified: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, notified: 0, reason: "geen subscriptions" });
      continue;
    }

    const compName = (stage as any).competitions?.name || "";
    const stageLabel = stage.stage_number === 0 ? "Proloog" : `Etappe ${stage.stage_number}`;
    const payload = {
      title: `🏁 Uitslag binnen — ${stageLabel}`,
      body: `${compName ? compName + ": " : ""}de klassementen zijn bijgewerkt. Bekijk de nieuwe stand!`,
      url: "/#dashboard",
    };

    let sent = 0;
    const statuses: (number | string)[] = [];
    for (const sub of subscriptions) {
      try {
        const res = await sendPush(sub.endpoint, sub, payload, privateKey, VAPID_PUBLIC_KEY, VAPID_SUBJECT);
        statuses.push(res.status);
        if (res.ok || res.status === 201) {
          sent++;
        } else if (res.status === 404 || res.status === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      } catch (e) {
        statuses.push((e as Error).message);
      }
    }

    await supabase.from("stages").update({ results_notified: true }).eq("id", stage.id);
    results.push({ stage_id: stage.id, stage_number: stage.stage_number, notified: sent, statuses });
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
