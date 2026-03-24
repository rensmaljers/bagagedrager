import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mapStageType(iconClass: string, stageName: string): string {
  if (stageName.toLowerCase().includes("itt") || stageName.toLowerCase().includes("tt")) return "tt";
  if (iconClass.includes("p5")) return "mountain";
  if (iconClass.includes("p4")) return "mountain";
  if (iconClass.includes("p3")) return "mountain";
  if (iconClass.includes("p2")) return "sprint";
  return "flat";
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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: profile } = await adminClient
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "Admin toegang vereist" }), { status: 403, headers: corsHeaders });
    }

    const { pcs_url, year } = await req.json();
    if (!pcs_url || !pcs_url.includes("procyclingstats.com")) {
      return new Response(JSON.stringify({ error: "Ongeldige PCS URL" }), { status: 400, headers: corsHeaders });
    }

    // Ensure we're fetching the stages overview page
    const stagesUrl = pcs_url.replace(/\/$/, "").replace(/\/stages$/, "") + "/stages";

    const pcsRes = await fetch(stagesUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!pcsRes.ok) {
      return new Response(JSON.stringify({ error: `PCS gaf status ${pcsRes.status}` }), { status: 502, headers: corsHeaders });
    }

    const html = await pcsRes.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) {
      return new Response(JSON.stringify({ error: "Kon pagina niet parsen" }), { status: 500, headers: corsHeaders });
    }

    // Parse stages from the basic table
    const table = doc.querySelector("table.basic");
    if (!table) {
      return new Response(JSON.stringify({ error: "Geen etappe-tabel gevonden" }), { status: 400, headers: corsHeaders });
    }

    const rows = table.querySelectorAll("tbody tr");
    const stages: any[] = [];
    const raceYear = year || new Date().getFullYear();

    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 4) continue;

      const dateText = cells[0]?.textContent?.trim() || ""; // "05/07"
      const stageLink = cells[3]?.querySelector("a");
      const stageName = stageLink?.textContent?.trim() || "";
      const iconSpan = cells[2]?.querySelector("span");
      const iconClass = iconSpan?.className || "";

      // Skip rest days
      if (!stageName || stageName.toLowerCase().includes("restday") || stageName.toLowerCase().includes("rest day")) continue;
      if (!stageLink?.getAttribute("href")) continue;

      // Parse stage number from name: "Stage 1 | Lille - Lille"
      const stageMatch = stageName.match(/Stage\s+(\d+)/i);
      if (!stageMatch) continue;
      const stageNum = parseInt(stageMatch[1]);

      // Parse route name: everything after " | "
      const routeName = stageName.includes("|") ? stageName.split("|")[1].trim() : stageName;

      // Parse date: "05/07" -> "2025-07-05"
      const dateParts = dateText.split("/");
      let dateISO = "";
      if (dateParts.length === 2) {
        dateISO = `${raceYear}-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")}`;
      }

      const stageType = mapStageType(iconClass, stageName);

      stages.push({
        stage_number: stageNum,
        name: routeName.replace(/\s+/g, " ").trim(),
        date: dateISO,
        stage_type: stageType,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      count: stages.length,
      stages,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
