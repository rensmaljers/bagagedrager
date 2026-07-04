import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { parseStagePage } from "../_shared/pcs-parse.ts";
import { fetchPcsPage } from "../_shared/pcs-fetch.ts";
import { importVapidPrivateKey, sendPush } from "../_shared/webpush.ts";

// Draait dagelijks om 09:00 en 16:00 UTC (11:00 en 18:00 Nederlandse zomertijd).
// Zoekt etappes die vandaag gereden worden en haalt de PCS-resultaten op.
// Parsen gebeurt via de gedeelde, geteste parseStagePage (incl. startlijst-guard,
// TTT- en ITT-formaten) — niet meer via een eigen inline kopie.
// Bij échte failures gaat er een push naar de admins (zie notifyAdminsOfFailures).

const VAPID_PUBLIC_KEY = "BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ";
const VAPID_SUBJECT = "https://hdkvirtytljnuawcmoui.supabase.co";

// Parser-guards ("nog geen uitslag op PCS") zijn bij de ochtend-run verwacht —
// de etappe is dan simpelweg nog bezig. Pas als de etappe al ruim voorbij zou
// moeten zijn is een guard-fout wél verdacht (HTML-wijziging of uitslag blijft uit).
// "Geen renners gevonden" hoort er ook bij: vóór de start rendert PCS een lege
// resultaten-tabel (smoke-test 4 juli: etappe 1 nog niet gestart → deze fout).
const GUARD_RE = /Geen (tijden|resultaten-tabel|renners gevonden)/;
const STAGE_SHOULD_BE_DONE_MS = 7 * 3600 * 1000;

async function notifyAdminsOfFailures(supabase: any, failures: any[]) {
  const vapidPrivateKeyRaw = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKeyRaw) return { pushed: 0, reason: "VAPID_PRIVATE_KEY niet ingesteld" };
  const privateKey = await importVapidPrivateKey(vapidPrivateKeyRaw, VAPID_PUBLIC_KEY);

  const { data: admins } = await supabase.from("profiles").select("id").eq("is_admin", true);
  const adminIds = (admins || []).map((a: any) => a.id);
  if (!adminIds.length) return { pushed: 0, reason: "geen admins" };

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .in("user_id", adminIds);
  if (!subs?.length) return { pushed: 0, reason: "geen admin-subscriptions" };

  const label = (f: any) => f.stage_number === 0 ? "Proloog" : `Etappe ${f.stage_number ?? f.stage_id}`;
  const payload = {
    title: `⚠️ PCS-sync mislukt (${failures.length} etappe${failures.length > 1 ? "s" : ""})`,
    body: failures.slice(0, 3).map((f) => `${label(f)}: ${f.error}`).join("\n").slice(0, 180),
    url: "/#admin",
  };

  let pushed = 0;
  for (const sub of subs) {
    try {
      const res = await sendPush(sub.endpoint, sub, payload, privateKey, VAPID_PUBLIC_KEY, VAPID_SUBJECT);
      if (res.ok || res.status === 201) pushed++;
      else if (res.status === 404 || res.status === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    } catch (_) { /* een kapotte subscription mag de rest niet blokkeren */ }
  }
  return { pushed };
}

// Spiegelt helpers.buildPcsStageUrl uit de frontend: bouwt de PCS-uitslag-URL voor
// een etappe. Eigen etappe-URL (klassiekers-bundel) heeft voorrang op de ronde-URL.
const STRIP_SUFFIX = /\/(stages|startlist|gc|general-classification|stage-\d+|prologue|results?|resuts?|overview)$/;
function buildStageUrl(stage: any): string | null {
  if (stage.pcs_url) {
    const base = stage.pcs_url.replace(/\/$/, "").replace(STRIP_SUFFIX, "");
    return `${base}/result`;
  }
  const comp = stage.competitions;
  if (!comp?.pcs_url) return null;
  const base = comp.pcs_url.replace(/\/$/, "").replace(STRIP_SUFFIX, "");
  if (comp.is_one_day) return `${base}/result`;
  if (stage.stage_number === 0) return `${base}/prologue`;
  return `${base}/stage-${stage.stage_number}`;
}

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

  // Twee modes:
  //  - vaste runs (9:00/16:00 UTC, lege body): alle etappes van vandaag,
  //    ook als er al resultaten staan (tweede pass vangt PCS-correcties)
  //  - "eta" (cron elke 15 min): alleen etappes waarvan de verwachte aankomst
  //    (stages.estimated_end_time) + marge verstreken is en die nog géén
  //    resultaten hebben — zo staat de uitslag er kort na de finish zonder
  //    dat we PCS de hele dag hameren
  const { mode } = await req.json().catch(() => ({} as any));
  const ETA_MARGIN_MS = 20 * 60 * 1000;

  // Haal alle etappes op die vandaag gereden worden, inclusief de PCS URL van de ronde.
  // De PCS-link staat meestal op de ronde (competitions.pcs_url), niet op elke losse
  // etappe — daarom bouwen we de etappe-URL zelf, net als de admin-knop in de frontend.
  const today = new Date().toISOString().slice(0, 10);
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, pcs_url, start_time, estimated_end_time, competition_id, competitions(pcs_url, is_one_day)")
    .gte("start_time", `${today}T00:00:00`)
    .lte("start_time", `${today}T23:59:59`);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!stages || stages.length === 0) {
    return new Response(JSON.stringify({ synced: 0, message: "Geen etappes vandaag" }));
  }

  const syncResults: any[] = [];
  const ridersByComp = new Map<number, any[]>(); // comp_id → renners (cache over etappes)
  // Failure-entries dragen stage_number + start_time mee voor de admin-push
  const fail = (stage: any, error: string) =>
    syncResults.push({ stage_id: stage.id, stage_number: stage.stage_number, start_time: stage.start_time, error });

  for (const stage of stages) {
    try {
      // ETA-mode: alleen syncen als de etappe klaar zou moeten zijn en er
      // nog geen uitslag staat. Skips zijn geen failures (geen admin-push).
      if (mode === "eta") {
        if (!stage.estimated_end_time) {
          syncResults.push({ stage_id: stage.id, skipped: "geen ETA — vaste runs pakken deze" });
          continue;
        }
        const readyAt = new Date(stage.estimated_end_time).getTime() + ETA_MARGIN_MS;
        if (Date.now() < readyAt) {
          syncResults.push({ stage_id: stage.id, skipped: `etappe nog bezig (klaar ~${stage.estimated_end_time})` });
          continue;
        }
        const { count } = await supabase
          .from("stage_results")
          .select("id", { count: "exact", head: true })
          .eq("stage_id", stage.id);
        if (count && count > 0) {
          syncResults.push({ stage_id: stage.id, skipped: "al gesynct" });
          continue;
        }
      }

      // Bouw de PCS-uitslag-URL (zelfde logica als helpers.buildPcsStageUrl in de frontend):
      // eigen etappe-URL (klassiekers) heeft voorrang, anders ronde-URL + /stage-N.
      const pcsUrl = buildStageUrl(stage);
      if (!pcsUrl) {
        fail(stage, "Geen PCS URL (ronde noch etappe)");
        continue;
      }

      // Fetch PCS pagina — gedeelde helper met retry/backoff bij 5xx/429/netwerkfout.
      // Gooit na uitputting; de outer catch zet dat om in een failure-entry.
      const pcsRes = await fetchPcsPage(pcsUrl);

      if (!pcsRes.ok) {
        fail(stage, `PCS status ${pcsRes.status}`);
        continue;
      }

      const html = await pcsRes.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc) {
        fail(stage, "Kon pagina niet parsen");
        continue;
      }

      // Profiel-afbeelding verversen: PCS her-shardt afbeeldings-URLs soms
      // (juli 2026: 20/21 TdF-profielen dood). De actuele URL staat op de
      // pagina die we toch al fetchen — vóór de parse, zodat dit ook op
      // startlijst-dagen (guard-fout) gebeurt.
      const profMatches = [...html.matchAll(/images\/profiles\/[^"']+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]);
      // Op bestandsnaam filteren, niet op het hele pad — dat bevat altijd "profiles/"
      const prof = profMatches.find((p) => /-profile/i.test(p.split("/").pop() || ""))
        || profMatches.find((p) => /final-km/i.test(p.split("/").pop() || ""))
        || profMatches[0];
      if (prof) {
        await supabase.from("stages")
          .update({ profile_image_url: `https://www.procyclingstats.com/${prof}` })
          .eq("id", stage.id);
      }

      // Gedeelde, geteste parser (STAGE/TTT/ITT-formaten + startlijst-guard).
      // Gooit een fout als de pagina nog de startlijst toont (geen tijden) → dan
      // niks opslaan en de etappe niet locken.
      let results: any[];
      try {
        results = parseStagePage(doc);
      } catch (e) {
        fail(stage, (e as Error).message);
        continue;
      }

      if (results.length === 0) {
        fail(stage, "Geen renners gevonden in tabel");
        continue;
      }

      // PCS-renners koppelen aan interne rider_id (admin_save_results verwacht rider_id,
      // niet slug/bib). Zelfde matching als helpers/buildPcsPayload in de frontend:
      // op pcs_slug eerst, dan bibnummer; gepickte renners krijgen voorrang bij dubbele match.
      let compRiders = ridersByComp.get(stage.competition_id);
      if (!compRiders) {
        const { data: rd } = await supabase
          .from("riders")
          .select("id, pcs_slug, bib_number")
          .eq("competition_id", stage.competition_id);
        compRiders = rd || [];
        ridersByComp.set(stage.competition_id, compRiders);
      }
      const { data: picks } = await supabase
        .from("picks").select("rider_id").eq("stage_id", stage.id);
      const pickedIds = new Set((picks || []).map((p: any) => p.rider_id));

      const matchRider = (r: any) => {
        if (r.pcs_slug) {
          const hit = compRiders.find((rd: any) => rd.pcs_slug === r.pcs_slug && pickedIds.has(rd.id));
          if (hit) return hit;
          const fb = compRiders.find((rd: any) => rd.pcs_slug === r.pcs_slug);
          if (fb) return fb;
        }
        if (r.bib_number) {
          const hit = compRiders.find((rd: any) => rd.bib_number === r.bib_number && pickedIds.has(rd.id));
          if (hit) return hit;
          return compRiders.find((rd: any) => rd.bib_number === r.bib_number);
        }
        return undefined;
      };

      let unmatched = 0;
      const payload: any[] = [];
      for (const r of results) {
        const rider = matchRider(r);
        if (rider) {
          payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, finish_position: r.finish_position, points: r.points, mountain_points: r.mountain_points, bonification_seconds: r.bonification_seconds || 0, dnf: r.dnf });
        } else { unmatched++; }
      }

      if (payload.length === 0) {
        fail(stage, `Geen renners gekoppeld (${unmatched} onbekend)`);
        continue;
      }

      // Sla resultaten op via admin_save_results
      const { data: saveData, error: saveError } = await supabase.rpc("admin_save_results", {
        p_stage_id: stage.id,
        p_results: payload,
      });

      if (saveError) {
        fail(stage, saveError.message);
      } else {
        syncResults.push({ stage_id: stage.id, stage_number: stage.stage_number, count: payload.length, unmatched, ...saveData });
      }
    } catch (e) {
      fail(stage, (e as Error).message);
    }
  }

  // Admin-push bij échte failures. Guard-fouten ("nog geen uitslag") tellen
  // alleen mee als de etappe al ruim voorbij zou moeten zijn — de ochtend-run
  // draait terwijl de etappe nog bezig is en mag geen vals alarm geven.
  // In eta-mode (elke 15 min) geldt diezelfde drempel voor álle fouten,
  // anders spamt een aanhoudende fout de admins elk kwartier.
  const failures = syncResults.filter((r: any) => r.error && (
    mode === "eta"
      ? (r.start_time && Date.now() - new Date(r.start_time).getTime() > STAGE_SHOULD_BE_DONE_MS)
      : (!GUARD_RE.test(r.error) ||
         (r.start_time && Date.now() - new Date(r.start_time).getTime() > STAGE_SHOULD_BE_DONE_MS))
  ));
  let adminPush: any = null;
  if (failures.length) {
    try {
      adminPush = await notifyAdminsOfFailures(supabase, failures);
    } catch (e) {
      adminPush = { pushed: 0, reason: (e as Error).message };
    }
  }

  return new Response(JSON.stringify({ synced: syncResults.filter(r => !r.error).length, results: syncResults, adminPush }), {
    headers: { "Content-Type": "application/json" },
  });
});
