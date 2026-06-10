import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importVapidPrivateKey, sendPush } from "../_shared/webpush.ts";

// Draait elke 30 minuten.
// Stuurt een browser push notificatie naar spelers die nog geen keuze hebben gemaakt
// voor een etappe waarvan de deadline over 30–90 minuten verstrijkt.

const VAPID_PUBLIC_KEY = "BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ";
const VAPID_SUBJECT = "https://hdkvirtytljnuawcmoui.supabase.co";

Deno.serve(async (req: Request) => {
  // Alleen aanroepbaar met het cron-secret (zelfde mechaniek als cron-refresh-specialties)
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

  // Etappes met deadline over 30–90 minuten, nog geen herinnering verstuurd
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, name, deadline, competition_id")
    .eq("reminder_sent", false)
    .gt("deadline", new Date(Date.now() + 30 * 60 * 1000).toISOString())
    .lt("deadline", new Date(Date.now() + 90 * 60 * 1000).toISOString());

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!stages?.length) return new Response(JSON.stringify({ reminded: 0 }));

  const results = [];

  for (const stage of stages) {
    // Gebruikers in deze competitie zonder keuze voor deze etappe
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("competition_id", stage.competition_id);

    const { data: picks } = await supabase
      .from("picks")
      .select("user_id")
      .eq("stage_id", stage.id);

    const pickedUserIds = new Set((picks || []).map((p: any) => p.user_id));
    const unpicked = (profiles || []).filter((p: any) => !pickedUserIds.has(p.id));

    if (!unpicked.length) {
      await supabase.from("stages").update({ reminder_sent: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, reminded: 0 });
      continue;
    }

    // Haal push subscriptions op voor deze gebruikers
    const unpickedIds = unpicked.map((p: any) => p.id);
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", unpickedIds);

    if (!subscriptions?.length) {
      await supabase.from("stages").update({ reminder_sent: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, reminded: 0, reason: "Geen subscriptions" });
      continue;
    }

    const deadlineMinutes = Math.round((new Date(stage.deadline).getTime() - Date.now()) / 60000);
    const payload = {
      title: `⏰ Keuze deadline nadert — Etappe ${stage.stage_number}`,
      body: `Nog ${deadlineMinutes} minuten om je renner te kiezen!`,
      url: "/#pick",
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
          // Subscription verlopen — opruimen zodat we er niet naar blijven sturen
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      } catch (e) {
        statuses.push((e as Error).message);
      }
    }

    await supabase.from("stages").update({ reminder_sent: true }).eq("id", stage.id);
    results.push({ stage_id: stage.id, stage_number: stage.stage_number, reminded: sent, statuses });
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
