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
      .select("endpoint, p256dh, auth_key, user_id")
      .in("user_id", participantIds);

    if (!subscriptions?.length) {
      await supabase.from("stages").update({ results_notified: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, notified: 0, reason: "geen subscriptions" });
      continue;
    }

    const compName = (stage as any).competitions?.name || "";
    const stageLabel = stage.stage_number === 0 ? "Proloog" : `Etappe ${stage.stage_number}`;

    // Personalisatie: eigen renner + spelpunten + nieuwe klassementspositie.
    // Valt terug op de generieke melding als de data ontbreekt.
    const [{ data: stagePicks }, { data: gc }] = await Promise.all([
      supabase.from("stage_picks_public")
        .select("user_id, rider_name, finish_position, effective_game_points, dnf, is_late, is_random, scoring_mode")
        .eq("stage_id", stage.id),
      supabase.from("general_classification")
        .select("user_id, total_time, total_game_points")
        .eq("competition_id", stage.competition_id),
    ]);
    const pickByUser = new Map((stagePicks || []).map((p: any) => [p.user_id, p]));
    const isClassic = (stagePicks || [])[0]?.scoring_mode === "classic";
    const gcSorted = [...(gc || [])].sort((a: any, b: any) =>
      isClassic ? (b.total_game_points || 0) - (a.total_game_points || 0) : a.total_time - b.total_time);
    const gcPos = new Map(gcSorted.map((r: any, i: number) => [r.user_id, i + 1]));
    const klassementNaam = isClassic ? "het spelklassement" : "het AK";

    // Vlag VÓÓR de verzendloop: crasht/time-out de functie halverwege, dan is
    // een zeldzame gemiste melding beter dan dat de volgende run (10 min later)
    // álle deelnemers een dubbele push stuurt.
    await supabase.from("stages").update({ results_notified: true }).eq("id", stage.id);

    const genericBody = `${compName ? compName + ": " : ""}de klassementen zijn bijgewerkt. Bekijk de nieuwe stand!`;
    const payloadForUser = (userId: string) => {
      const p: any = pickByUser.get(userId);
      if (!p) return { title: `🏁 Uitslag binnen — ${stageLabel}`, body: genericBody, url: "/#dashboard" };
      const pos = gcPos.get(userId);
      const posStr = pos ? ` · nu P${pos} in ${klassementNaam}` : "";
      const rad = p.is_random ? " (Rad)" : "";
      let body: string;
      if (p.dnf) {
        body = `${p.rider_name}${rad} haalde de finish niet (DNF) — 0 punten${posStr}.`;
      } else if (p.finish_position) {
        const pts = p.is_late ? 0 : (p.effective_game_points ?? 0);
        body = `${p.rider_name}${rad} werd ${p.finish_position}e → jij +${pts} spelpunten${posStr}.`;
      } else {
        body = genericBody;
      }
      return { title: `🏁 ${stageLabel} — uitslag binnen`, body, url: "/#dashboard" };
    };

    let sent = 0;
    const statuses: (number | string)[] = [];
    for (const sub of subscriptions) {
      try {
        const payload = payloadForUser((sub as any).user_id);
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

    results.push({ stage_id: stage.id, stage_number: stage.stage_number, notified: sent, statuses });
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
