import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // Afstand (km) — laatste kolom
    const distanceText = cells[cells.length - 1]?.textContent?.trim() || "";
    const distance_km = parseFloat(distanceText) || null;

    // Start/finish uit routenaam (bijv. "Figueres - Banyoles")
    let departure = null, arrival = null;
    const routeParts = routeName.split(/\s*[-–›→]\s*/);
    if (routeParts.length >= 2) {
      departure = routeParts[0].replace(/Stage\s+\d+\s*/i, "").trim() || null;
      arrival = routeParts[routeParts.length - 1].trim() || null;
    }

    // PCS stage URL voor profiel-ophaling
    const stageHref = stageLink.getAttribute("href") || "";

    stages.push({
      stage_number: parseInt(stageMatch[1]),
      name: routeName.replace(/\s+/g, " ").trim(),
      date: dateISO,
      stage_type: mapStageType(iconClass, stageName),
      distance_km,
      departure,
      arrival,
      _href: stageHref,
    });
  }
  return stages;
}

// Haal profiel-afbeelding op per etappe
async function fetchStageProfiles(stages: any[], baseUrl: string): Promise<Record<number, string>> {
  const profiles: Record<number, string> = {};
  for (const s of stages) {
    try {
      if (!s._href) continue;
      const url = s._href.startsWith("http") ? s._href : `https://www.procyclingstats.com/${s._href}`;
      const doc = await fetchPCS(url);
      // Zoek profiel-afbeelding: img src bevat "profile"
      const imgs = doc.querySelectorAll("img");
      for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (src.includes("profile")) {
          profiles[s.stage_number] = src.startsWith("http") ? src : `https://www.procyclingstats.com/${src}`;
          break;
        }
      }
    } catch {
      // Niet fataal — profiel is optioneel
    }
  }
  return profiles;
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    const baseUrl = pcs_url.replace(/\/$/, "").replace(/\/(stages|startlist|gc|stage-\d+|results?|resuts)$/, "");
    const raceYear = parseInt(baseUrl.match(/\/(\d{4})/)?.[1] || String(new Date().getFullYear()));

    // Check of het een eendagskoers is
    const { data: comp } = await adminClient
      .from("competitions").select("is_one_day,name").eq("id", competition_id).single();

    const log: string[] = [];

    // 1. Fetch & parse stages
    log.push("📅 Etappes ophalen...");
    let stages: any[] = [];

    if (comp?.is_one_day) {
      // Eendagskoers: haal datum, afstand en profiel van de race-overzichtspagina
      try {
        const overviewDoc = await fetchPCS(baseUrl);
        // Zoek infolist items
        const infoItems = overviewDoc.querySelectorAll(".infolist li");
        let dateISO = `${raceYear}-01-01`;
        let distance_km = null;
        for (const li of infoItems) {
          const divs = li.querySelectorAll("div");
          const label = (divs[0]?.textContent?.trim() || "").toLowerCase();
          const value = divs[1]?.textContent?.trim() || "";
          if (label.includes("startdate") || label.includes("date")) {
            dateISO = value.includes("-") ? value : dateISO;
            if (value.includes("/")) {
              const parts = value.split("/");
              dateISO = `${raceYear}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
            }
          }
          if (label.includes("distance")) {
            distance_km = parseFloat(value) || null;
          }
        }
        // Profiel-afbeelding
        let profileUrl = null;
        const imgs = overviewDoc.querySelectorAll("img");
        for (const img of imgs) {
          const src = img.getAttribute("src") || "";
          if (src.includes("profile")) {
            profileUrl = src.startsWith("http") ? src : `https://www.procyclingstats.com/${src}`;
            break;
          }
        }
        stages = [{
          stage_number: 1,
          name: comp.name || "Eendagskoers",
          date: dateISO,
          stage_type: "flat",
          distance_km,
          departure: null,
          arrival: null,
          profile_image_url: profileUrl,
        }];
        log.push(`✅ 1 etappe (eendagskoers)${distance_km ? ` — ${distance_km} km` : ''}${profileUrl ? ' — profiel gevonden' : ''}`);
      } catch (e) {
        stages = [{
          stage_number: 1,
          name: comp.name || "Eendagskoers",
          date: `${raceYear}-01-01`,
          stage_type: "flat",
        }];
        log.push(`⚠️ Datum niet gevonden, etappe aangemaakt met standaarddatum`);
      }
    } else {
      try {
        const stagesDoc = await fetchPCS(baseUrl + "/stages");
        stages = parseStages(stagesDoc, raceYear);
        log.push(`✅ ${stages.length} etappes gevonden`);
      } catch (e) {
        log.push(`⚠️ Etappes: ${e.message}`);
      }
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

    // 3. Fetch stage profile images (parallel met startlijst kan niet, PCS rate limit)
    let stageProfiles: Record<number, string> = {};
    if (stages.length > 0 && !comp?.is_one_day) {
      log.push("🏔️ Etappeprofielen ophalen...");
      try {
        stageProfiles = await fetchStageProfiles(stages, baseUrl);
        log.push(`✅ ${Object.keys(stageProfiles).length} profielen gevonden`);
      } catch (e) {
        log.push(`⚠️ Profielen: ${e.message}`);
      }
    }

    // 4. Save stages
    let stagesSaved = 0, stagesSkipped = 0;
    for (const s of stages) {
      const startTime = new Date(`${s.date}T12:00:00`);
      // ETA: start + (afstand / 40 km/u) + 1 uur buffer voor PCS verwerking
      const durationHours = s.distance_km ? (s.distance_km / 40) + 1 : 6;
      const estimatedEnd = new Date(startTime.getTime() + durationHours * 3600 * 1000);
      const { _href, profile_image_url, ...stageData } = s; // interne velden apart
      try {
        await adminClient.from("stages").insert({
          ...stageData,
          profile_image_url: profile_image_url || stageProfiles[s.stage_number] || null,
          start_time: startTime.toISOString(),
          deadline: startTime.toISOString(),
          estimated_end_time: estimatedEnd.toISOString(),
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
