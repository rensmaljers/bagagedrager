import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { parseStagePage } from "../_shared/pcs-parse.ts";

// Draait dagelijks om 09:00 en 16:00 UTC (11:00 en 18:00 Nederlandse zomertijd).
// Zoekt etappes die vandaag gereden worden en haalt de PCS-resultaten op.
// Parsen gebeurt via de gedeelde, geteste parseStagePage (incl. startlijst-guard,
// TTT- en ITT-formaten) — niet meer via een eigen inline kopie.

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

  // Haal alle etappes op die vandaag gereden worden, inclusief de PCS URL van de ronde.
  // De PCS-link staat meestal op de ronde (competitions.pcs_url), niet op elke losse
  // etappe — daarom bouwen we de etappe-URL zelf, net als de admin-knop in de frontend.
  const today = new Date().toISOString().slice(0, 10);
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, pcs_url, competition_id, competitions(pcs_url, is_one_day)")
    .gte("start_time", `${today}T00:00:00`)
    .lte("start_time", `${today}T23:59:59`);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!stages || stages.length === 0) {
    return new Response(JSON.stringify({ synced: 0, message: "Geen etappes vandaag" }));
  }

  const syncResults = [];
  const ridersByComp = new Map<number, any[]>(); // comp_id → renners (cache over etappes)

  for (const stage of stages) {
    try {
      // Bouw de PCS-uitslag-URL (zelfde logica als helpers.buildPcsStageUrl in de frontend):
      // eigen etappe-URL (klassiekers) heeft voorrang, anders ronde-URL + /stage-N.
      const pcsUrl = buildStageUrl(stage);
      if (!pcsUrl) {
        syncResults.push({ stage_id: stage.id, error: "Geen PCS URL (ronde noch etappe)" });
        continue;
      }

      // Fetch PCS pagina
      const pcsRes = await fetch(pcsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });

      if (!pcsRes.ok) {
        syncResults.push({ stage_id: stage.id, error: `PCS status ${pcsRes.status}` });
        continue;
      }

      const html = await pcsRes.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc) {
        syncResults.push({ stage_id: stage.id, error: "Kon pagina niet parsen" });
        continue;
      }

      // Gedeelde, geteste parser (STAGE/TTT/ITT-formaten + startlijst-guard).
      // Gooit een fout als de pagina nog de startlijst toont (geen tijden) → dan
      // niks opslaan en de etappe niet locken.
      let results: any[];
      try {
        results = parseStagePage(doc);
      } catch (e) {
        syncResults.push({ stage_id: stage.id, error: (e as Error).message });
        continue;
      }

      if (results.length === 0) {
        syncResults.push({ stage_id: stage.id, error: "Geen renners gevonden in tabel" });
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
        syncResults.push({ stage_id: stage.id, error: `Geen renners gekoppeld (${unmatched} onbekend)` });
        continue;
      }

      // Sla resultaten op via admin_save_results
      const { data: saveData, error: saveError } = await supabase.rpc("admin_save_results", {
        p_stage_id: stage.id,
        p_results: payload,
      });

      if (saveError) {
        syncResults.push({ stage_id: stage.id, error: saveError.message });
      } else {
        syncResults.push({ stage_id: stage.id, stage_number: stage.stage_number, count: payload.length, unmatched, ...saveData });
      }
    } catch (e) {
      syncResults.push({ stage_id: stage.id, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ synced: syncResults.filter(r => !r.error).length, results: syncResults }), {
    headers: { "Content-Type": "application/json" },
  });
});
