import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseTime(timeStr: string): number {
  // PCS time formats: "3:53:11", "53:11", "11"
  const clean = timeStr.replace(/[^0-9:]/g, "").trim();
  if (!clean) return 0;
  const parts = clean.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Niet ingelogd" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Niet ingelogd" }), { status: 401, headers: corsHeaders });

    // Check admin
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: profile } = await adminClient
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "Admin toegang vereist" }), { status: 403, headers: corsHeaders });
    }

    const { pcs_url } = await req.json();
    if (!pcs_url || !pcs_url.includes("procyclingstats.com")) {
      return new Response(JSON.stringify({ error: "Ongeldige PCS URL" }), { status: 400, headers: corsHeaders });
    }

    // Fetch PCS page
    const pcsRes = await fetch(pcs_url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!pcsRes.ok) {
      return new Response(JSON.stringify({ error: `PCS gaf status ${pcsRes.status}. Probeer het later opnieuw.` }), { status: 502, headers: corsHeaders });
    }

    const html = await pcsRes.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) {
      return new Response(JSON.stringify({ error: "Kon pagina niet parsen" }), { status: 500, headers: corsHeaders });
    }

    // Parse stage results from first table.results
    const table = doc.querySelector("table.results");
    if (!table) {
      return new Response(JSON.stringify({ error: "Geen resultaten-tabel gevonden op deze pagina" }), { status: 400, headers: corsHeaders });
    }

    const rows = table.querySelectorAll("tbody tr");
    const results: any[] = [];
    let lastTime = 0;

    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 8) continue;

      // Find cells by class
      let bib = 0, time = 0, points = 0, dnf = false;

      for (const cell of cells) {
        const cls = cell.className || "";
        const text = cell.textContent?.trim() || "";

        if (cls.includes("bibs")) {
          bib = parseInt(text) || 0;
        } else if (cls.includes("time") && cls.includes("ar")) {
          // Time cell contains <font>H:MM:SS</font>
          const fontEl = cell.querySelector("font");
          const timeText = fontEl?.textContent?.trim() || text;
          if (timeText.toLowerCase().includes("dnf") || timeText.toLowerCase().includes("dns") || timeText.toLowerCase().includes("otl")) {
            dnf = true;
          } else {
            const parsed = parseTime(timeText);
            if (parsed > 0) {
              time = parsed;
              lastTime = parsed;
            } else {
              // Same time as previous (PCS shows ,, or empty for same time group)
              time = lastTime;
            }
          }
        } else if (cls.includes("pnt") && !cls.includes("uci")) {
          points = parseInt(text) || 0;
        }
      }

      if (bib > 0) {
        results.push({ bib_number: bib, time_seconds: time || lastTime, points, mountain_points: 0, dnf });
      }
    }

    // Try to parse mountain points from KOM classification table (usually 3rd table)
    const tables = doc.querySelectorAll("table.results");
    for (let i = 1; i < tables.length; i++) {
      const headerRow = tables[i].querySelector("thead tr");
      if (!headerRow) continue;
      const headers = headerRow.textContent || "";
      // Mountain/KOM classification usually has fewer rows and specific header
      if (headers.includes("Rnk") && tables[i].querySelectorAll("tbody tr").length < 30) {
        const komRows = tables[i].querySelectorAll("tbody tr");
        for (const row of komRows) {
          const cells = row.querySelectorAll("td");
          let komBib = 0, komPts = 0;
          for (const cell of cells) {
            const cls = cell.className || "";
            const text = cell.textContent?.trim() || "";
            if (cls.includes("bibs")) komBib = parseInt(text) || 0;
            if (cls.includes("pnt") && !cls.includes("uci")) komPts = parseInt(text) || 0;
          }
          if (komBib > 0 && komPts > 0) {
            const existing = results.find(r => r.bib_number === komBib);
            if (existing) existing.mountain_points = komPts;
          }
        }
        break; // Only use first matching classification table
      }
    }

    return new Response(JSON.stringify({
      success: true,
      count: results.length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
