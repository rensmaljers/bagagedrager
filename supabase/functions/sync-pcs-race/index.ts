import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PCS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function mapStageType(iconClass: string, name: string): string {
  if (name.toLowerCase().includes("itt") || name.toLowerCase().includes("(tt)")) return "tt";
  if (iconClass.includes("p5") || iconClass.includes("p4")) return "mountain";
  if (iconClass.includes("p3")) return "mountain";
  if (iconClass.includes("p2")) return "sprint";
  return "flat";
}

async function fetchPCS(url: string): Promise<any> {
  const res = await fetch(url, { headers: PCS_HEADERS });
  if (!res.ok) throw new Error(`PCS gaf status ${res.status} voor ${url}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Kon pagina niet parsen");
  return doc;
}

function parseStages(doc: any, year: number) {
  const table = doc.querySelector("table.basic");
  if (!table) return [];

  const rows = table.querySelectorAll("tbody tr");
  const stages: any[] = [];

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 4) continue;

    const dateText = cells[0]?.textContent?.trim() || "";
    const stageLink = cells[3]?.querySelector("a");
    const stageName = stageLink?.textContent?.trim() || "";
    const iconSpan = cells[2]?.querySelector("span");
    const iconClass = iconSpan?.className || "";

    if (!stageName || stageName.toLowerCase().includes("rest")) continue;
    if (!stageLink?.getAttribute("href")) continue;

    const stageMatch = stageName.match(/Stage\s+(\d+)/i);
    if (!stageMatch) continue;

    const routeName = stageName.includes("|") ? stageName.split("|")[1].trim() : stageName;
    const dateParts = dateText.split("/");
    let dateISO = "";
    if (dateParts.length === 2) {
      dateISO = `${year}-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")}`;
    }

    stages.push({
      stage_number: parseInt(stageMatch[1]),
      name: routeName.replace(/\s+/g, " ").trim(),
      date: dateISO,
      stage_type: mapStageType(iconClass, stageName),
    });
  }
  return stages;
}

function parseStartlist(doc: any) {
  const riders: any[] = [];
  const shirts: Record<string, string> = {};

  const teams = doc.querySelectorAll("ul.startlist_v4 > li");
  for (const li of teams) {
    const teamEl = li.querySelector("a.team");
    const teamName = teamEl?.textContent?.trim()?.replace(/\s*\(.*\)/, "") || "";

    const shirtImg = li.querySelector(".shirtCont img");
    if (shirtImg && teamName) {
      const src = shirtImg.getAttribute("src") || "";
      if (src) shirts[teamName] = src.startsWith("http") ? src : `https://www.procyclingstats.com/${src}`;
    }

    const riderEls = li.querySelectorAll(".ridersCont ul li");
    for (const rider of riderEls) {
      const bib = parseInt(rider.querySelector(".bib")?.textContent?.trim() || "0");
      let name = rider.querySelector("a")?.textContent?.trim() || "";
      name = name.replace(/\s*\(.*\)$/, "");
      if (bib && name) riders.push({ bib_number: bib, name, team: teamName });
    }
  }

  return { riders, shirts };
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

    const { pcs_url, competition_id } = await req.json();
    if (!pcs_url || !pcs_url.includes("procyclingstats.com")) {
      return new Response(JSON.stringify({ error: "Ongeldige PCS URL" }), { status: 400, headers: corsHeaders });
    }
    if (!competition_id) {
      return new Response(JSON.stringify({ error: "Geen competitie geselecteerd" }), { status: 400, headers: corsHeaders });
    }

    const baseUrl = pcs_url.replace(/\/$/, "").replace(/\/(stages|startlist|gc|stage-\d+)$/, "");
    const raceYear = parseInt(baseUrl.match(/\/(\d{4})/)?.[1] || String(new Date().getFullYear()));

    const log: string[] = [];

    // 1. Fetch & parse stages
    log.push("📅 Etappes ophalen...");
    let stages: any[] = [];
    try {
      const stagesDoc = await fetchPCS(baseUrl + "/stages");
      stages = parseStages(stagesDoc, raceYear);
      log.push(`✅ ${stages.length} etappes gevonden`);
    } catch (e) {
      log.push(`⚠️ Etappes: ${e.message}`);
    }

    // 2. Fetch & parse startlist + shirts
    log.push("🚴 Startlijst ophalen...");
    let riders: any[] = [];
    let shirts: Record<string, string> = {};
    try {
      const startDoc = await fetchPCS(baseUrl + "/startlist");
      const result = parseStartlist(startDoc);
      riders = result.riders;
      shirts = result.shirts;
      log.push(`✅ ${riders.length} renners + ${Object.keys(shirts).length} team shirts gevonden`);
    } catch (e) {
      log.push(`⚠️ Startlijst: ${e.message}`);
    }

    // 3. Save stages
    let stagesSaved = 0, stagesSkipped = 0;
    for (const s of stages) {
      const startTime = new Date(`${s.date}T12:00:00`);
      try {
        await adminClient.from("stages").insert({
          ...s,
          start_time: startTime.toISOString(),
          deadline: startTime.toISOString(),
          locked: false,
          competition_id,
        });
        stagesSaved++;
      } catch { stagesSkipped++; }
    }
    log.push(`📅 Etappes: ${stagesSaved} opgeslagen, ${stagesSkipped} overgeslagen`);

    // 4. Save riders
    let ridersSaved = 0, ridersSkipped = 0;
    for (const r of riders) {
      try {
        await adminClient.from("riders").insert({ ...r, competition_id });
        ridersSaved++;
      } catch { ridersSkipped++; }
    }
    log.push(`🚴 Renners: ${ridersSaved} opgeslagen, ${ridersSkipped} overgeslagen`);

    return new Response(JSON.stringify({
      success: true,
      log,
      stages_count: stagesSaved,
      riders_count: ridersSaved,
      shirts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
