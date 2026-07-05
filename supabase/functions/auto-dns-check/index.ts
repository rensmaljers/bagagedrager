import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { fetchPcsPage } from "../_shared/pcs-fetch.ts";
import { parseDropoutsPage } from "../_shared/pcs-dropouts.ts";
import { importVapidPrivateKey, sendPush } from "../_shared/webpush.ts";

// Draait elke 30 minuten (cron, migratie 072). Vóór elke etappe checken we of
// alle gepickte renners nog opstappen: PCS' dropouts-pagina wordt geparset,
// nieuwe uitvallers krijgen riders.dnf = true (waardoor submit_pick ze blokkeert
// en het pick-grid ze grijs toont), en spelers met een pick op zo'n renner
// krijgen een push zodat ze vóór de deadline kunnen wisselen.
// Push gaat alleen over renners die in DEZE run gemarkeerd worden — geen herhaling.

const VAPID_PUBLIC_KEY = "BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ";
const VAPID_SUBJECT = "https://hdkvirtytljnuawcmoui.supabase.co";
const WINDOW_MS = 3 * 3600 * 1000; // check etappes met een deadline binnen 3 uur

const STRIP_SUFFIX = /\/(stages|startlist|gc|general-classification|stage-\d+|prologue|results?|resuts?|overview|dropouts)$/;

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

  // Etappes waarvan de deadline binnen het venster ligt (en nog niet voorbij is)
  const now = new Date();
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, deadline, competition_id, competitions(pcs_url, name)")
    .gt("deadline", now.toISOString())
    .lt("deadline", new Date(now.getTime() + WINDOW_MS).toISOString());

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!stages?.length) return new Response(JSON.stringify({ checked: 0, message: "Geen etappes met deadline binnen 3 uur" }));

  const results: any[] = [];
  const dropoutsByComp = new Map<number, any[]>();

  for (const stage of stages) {
    try {
      const comp = (stage as any).competitions;
      if (!comp?.pcs_url) {
        results.push({ stage_id: stage.id, skipped: "geen PCS URL op de ronde" });
        continue;
      }

      // Dropouts per competitie maar één keer ophalen
      let dropouts = dropoutsByComp.get(stage.competition_id);
      if (!dropouts) {
        const base = comp.pcs_url.replace(/\/$/, "").replace(STRIP_SUFFIX, "");
        const res = await fetchPcsPage(`${base}/results/dropouts`);
        if (!res.ok) {
          results.push({ stage_id: stage.id, error: `PCS status ${res.status}` });
          continue;
        }
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        dropouts = doc ? parseDropoutsPage(doc) : [];
        dropoutsByComp.set(stage.competition_id, dropouts);
      }
      if (!dropouts.length) {
        results.push({ stage_id: stage.id, dropouts: 0 });
        continue;
      }

      // Match op pcs_slug; alleen renners die nog niet als uitvaller gemarkeerd zijn
      const slugs = dropouts.map((d) => d.pcs_slug);
      const { data: riders } = await supabase
        .from("riders")
        .select("id, name, pcs_slug, dnf")
        .eq("competition_id", stage.competition_id)
        .in("pcs_slug", slugs);
      const fresh = (riders || []).filter((r: any) => !r.dnf);

      if (fresh.length) {
        await supabase.from("riders").update({ dnf: true }).in("id", fresh.map((r: any) => r.id));
      }

      // Spelers met een pick op een zojuist gemarkeerde renner voor deze etappe
      let notified = 0;
      if (fresh.length) {
        const { data: picks } = await supabase
          .from("picks")
          .select("user_id, rider_id")
          .eq("stage_id", stage.id)
          .in("rider_id", fresh.map((r: any) => r.id));

        if (picks?.length) {
          const vapidPrivateKeyRaw = Deno.env.get("VAPID_PRIVATE_KEY");
          if (vapidPrivateKeyRaw) {
            const privateKey = await importVapidPrivateKey(vapidPrivateKeyRaw, VAPID_PUBLIC_KEY);
            const riderById = new Map(fresh.map((r: any) => [r.id, r]));
            const typeBySlug = new Map(dropouts.map((d) => [d.pcs_slug, d.type]));
            const deadlineStr = new Date(stage.deadline).toLocaleTimeString("nl-NL", {
              hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam",
            });

            // Subscriptions in één query (geen N+1 bij massale uitval)
            const { data: allSubs } = await supabase
              .from("push_subscriptions")
              .select("endpoint, p256dh, auth_key, user_id")
              .in("user_id", picks.map((p: any) => p.user_id));
            const subsByUser = new Map<string, any[]>();
            for (const s of allSubs || []) {
              const list = subsByUser.get(s.user_id) || [];
              list.push(s);
              subsByUser.set(s.user_id, list);
            }

            for (const pick of picks) {
              const rider = riderById.get(pick.rider_id);
              if (!rider) continue;
              const type = typeBySlug.get(rider.pcs_slug) || "DNS";
              const payload = {
                title: `⚠️ ${rider.name} stapt niet op`,
                body: `Je keuze voor deze etappe staat als ${type} bij PCS. Kies vóór ${deadlineStr} een andere renner!`,
                url: "/#pick",
              };
              for (const sub of subsByUser.get(pick.user_id) || []) {
                try {
                  const res = await sendPush(sub.endpoint, sub, payload, privateKey, VAPID_PUBLIC_KEY, VAPID_SUBJECT);
                  if (res.ok || res.status === 201) notified++;
                  else if (res.status === 404 || res.status === 410) {
                    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
                  }
                } catch (_) { /* kapotte subscription blokkeert de rest niet */ }
              }
            }
          }
        }
      }

      results.push({
        stage_id: stage.id,
        stage_number: stage.stage_number,
        dropouts: dropouts.length,
        nieuw_gemarkeerd: fresh.map((r: any) => r.name),
        notified,
      });
    } catch (e) {
      results.push({ stage_id: stage.id, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ checked: stages.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
