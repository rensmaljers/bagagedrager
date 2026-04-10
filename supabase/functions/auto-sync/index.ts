import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

// Draait dagelijks om 09:00 en 16:00 UTC (11:00 en 18:00 Nederlandse zomertijd).
// Zoekt etappes die vandaag gereden worden en een PCS URL hebben,
// haalt de resultaten op van PCS en slaat ze op.

function parseTime(timeStr: string): number {
  const clean = timeStr.replace(/[^0-9:]/g, "").trim();
  if (!clean) return 0;
  const parts = clean.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Haal etappes op die vandaag gereden worden en een PCS URL hebben
  const today = new Date().toISOString().slice(0, 10);
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, pcs_url, competition_id")
    .not("pcs_url", "is", null)
    .gte("start_time", `${today}T00:00:00`)
    .lte("start_time", `${today}T23:59:59`);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!stages || stages.length === 0) {
    return new Response(JSON.stringify({ synced: 0, message: "Geen etappes vandaag" }));
  }

  const syncResults = [];

  for (const stage of stages) {
    try {
      // Fetch PCS pagina
      const pcsRes = await fetch(stage.pcs_url, {
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

      const table = doc.querySelector("table.results");
      if (!table) {
        syncResults.push({ stage_id: stage.id, error: "Geen resultaten-tabel gevonden" });
        continue;
      }

      const rows = table.querySelectorAll("tbody tr");
      const results: any[] = [];
      let winnerTime = 0;
      let lastTime = 0;
      let position = 0;

      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 8) continue;

        let bib = 0, time = 0, dnf = false;
        let pcs_slug: string | null = null;

        const riderLink = row.querySelector("a[href*='rider/']");
        if (riderLink) {
          const href = riderLink.getAttribute("href") || "";
          pcs_slug = href.replace(/^.*rider\//, "").trim() || null;
        }

        for (const cell of cells) {
          const cls = cell.className || "";
          const text = cell.textContent?.trim() || "";

          if (/\b(dnf|dns|otl|dsq)\b/i.test(text)) {
            dnf = true;
          }

          if (cls.includes("bibs")) {
            bib = parseInt(text) || 0;
          } else if (cls.includes("time") && cls.includes("ar")) {
            const fontEl = cell.querySelector("font");
            const timeText = fontEl?.textContent?.trim() || text;
            if (/\b(dnf|dns|otl|dsq)\b/i.test(timeText)) {
              dnf = true;
            } else {
              const parsed = parseTime(timeText);
              if (parsed > 0) {
                if (winnerTime === 0) {
                  winnerTime = parsed;
                  time = parsed;
                } else {
                  time = winnerTime + parsed;
                }
                lastTime = time;
              } else {
                time = lastTime;
              }
            }
          }
        }

        let bonus = 0;
        for (const cell of cells) {
          const cls = cell.className || "";
          if (cls.includes("ar") && cls.includes("cu600")) {
            const txt = cell.textContent || "";
            const matches = [...txt.matchAll(/(\d+)\u2033/g)];
            bonus = matches.reduce((sum, m) => sum + parseInt(m[1]), 0);
          }
        }

        if (bib > 0 || pcs_slug) {
          position++;
          results.push({ bib_number: bib, pcs_slug, time_seconds: time || lastTime, finish_position: dnf ? null : position, points: 0, mountain_points: 0, bonification_seconds: bonus, dnf });
        }
      }

      // Punten- en bergklassement
      function findTabTable(tabKeyword: string) {
        const tabLinks = doc.querySelectorAll("ul.restabs li a, ul.resultTabs li a");
        for (const link of tabLinks) {
          const text = (link.textContent || "").toUpperCase();
          if (text.includes(tabKeyword)) {
            const dataId = link.getAttribute("data-id");
            if (dataId) {
              const tabDiv = doc.querySelector(`div.resTab[data-id="${dataId}"]`);
              return tabDiv?.querySelector("table.results") || null;
            }
          }
        }
        return null;
      }

      function extractClassificationPoints(classTable: any, field: "points" | "mountain_points") {
        if (!classTable) return;
        for (const row of classTable.querySelectorAll("tbody tr")) {
          const cells = row.querySelectorAll("td");
          let classBib = 0, classPts = 0, classSlug: string | null = null;
          const riderLink = row.querySelector("a[href*='rider/']");
          if (riderLink) {
            const href = riderLink.getAttribute("href") || "";
            classSlug = href.replace(/^.*rider\//, "").trim() || null;
          }
          for (const cell of cells) {
            const cls = cell.className || "";
            const text = cell.textContent?.trim() || "";
            if (cls.includes("bibs")) classBib = parseInt(text) || 0;
            if (cls.includes("pnt") && !cls.includes("uci")) classPts = parseInt(text) || 0;
          }
          if ((classBib > 0 || classSlug) && classPts > 0) {
            const existing = results.find(r =>
              (classSlug && r.pcs_slug === classSlug) || (classBib > 0 && r.bib_number === classBib)
            );
            if (existing) existing[field] = classPts;
          }
        }
      }

      extractClassificationPoints(findTabTable("POINTS"), "points");
      extractClassificationPoints(findTabTable("KOM"), "mountain_points");

      function extractBonifications(bonisTable: any) {
        if (!bonisTable) return;
        for (const row of bonisTable.querySelectorAll("tbody tr")) {
          const cells = row.querySelectorAll("td");
          let bBib = 0, bPts = 0, bSlug: string | null = null;
          const riderLink = row.querySelector("a[href*='rider/']");
          if (riderLink) {
            const href = riderLink.getAttribute("href") || "";
            bSlug = href.replace(/^.*rider\//, "").trim() || null;
          }
          for (const cell of cells) {
            const cls = cell.className || "";
            const text = cell.textContent?.trim() || "";
            if (cls.includes("bibs")) bBib = parseInt(text) || 0;
            if ((cls.includes("bonis") || cls.includes("pnt")) && !cls.includes("uci")) {
              const n = parseInt(text.replace(/[^\d]/g, "")) || 0;
              if (n > bPts) bPts = n;
            }
          }
          if ((bBib > 0 || bSlug) && bPts > 0) {
            const existing = results.find(r =>
              (bSlug && r.pcs_slug === bSlug) || (bBib > 0 && r.bib_number === bBib)
            );
            if (existing) existing.bonification_seconds = bPts;
          }
        }
      }
      extractBonifications(findTabTable("BONIS") || findTabTable("BONIFICATION"));

      if (results.length === 0) {
        syncResults.push({ stage_id: stage.id, error: "Geen renners gevonden in tabel" });
        continue;
      }

      // Sla resultaten op via admin_save_results
      const { data: saveData, error: saveError } = await supabase.rpc("admin_save_results", {
        p_stage_id: stage.id,
        p_results: results,
      });

      if (saveError) {
        syncResults.push({ stage_id: stage.id, error: saveError.message });
      } else {
        syncResults.push({ stage_id: stage.id, stage_number: stage.stage_number, count: results.length, ...saveData });
      }
    } catch (e) {
      syncResults.push({ stage_id: stage.id, error: e.message });
    }
  }

  return new Response(JSON.stringify({ synced: syncResults.filter(r => !r.error).length, results: syncResults }), {
    headers: { "Content-Type": "application/json" },
  });
});
