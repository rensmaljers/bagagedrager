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

// PCS tijden zijn in CET/CEST — bepaal juiste UTC offset voor een datum
function cetOffsetForDate(dateISO: string): string {
  // CEST (UTC+2): laatste zondag maart t/m laatste zondag oktober
  const d = new Date(dateISO + "T12:00:00Z");
  const year = d.getFullYear();
  // Laatste zondag van maart
  const marchLast = new Date(Date.UTC(year, 2, 31));
  marchLast.setUTCDate(31 - marchLast.getUTCDay());
  // Laatste zondag van oktober
  const octLast = new Date(Date.UTC(year, 9, 31));
  octLast.setUTCDate(31 - octLast.getUTCDay());
  // CEST als datum valt in zomertijd
  if (d >= marchLast && d < octLast) return "+02:00";
  return "+01:00";
}

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
    let dateISO = "";
    // PCS datum formaten: "5/07", "05/07", "5 Jul", etc.
    if (dateText.includes("/")) {
      const dateParts = dateText.split("/");
      if (dateParts.length === 2) {
        dateISO = `${year}-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")}`;
      }
    }
    if (!dateISO) {
      // Fallback: probeer dag + maandnaam (bijv. "5 Jul")
      const months: Record<string, string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const m = dateText.match(/(\d{1,2})\s+(\w{3})/i);
      if (m && months[m[2].toLowerCase()]) {
        dateISO = `${year}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
      }
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

// Haal profiel-afbeelding en starttijd op per etappe
async function fetchStageDetails(stages: any[]): Promise<{ profiles: Record<number, string>, startTimes: Record<number, string> }> {
  const profiles: Record<number, string> = {};
  const startTimes: Record<number, string> = {};
  for (const s of stages) {
    try {
      if (!s._href) continue;
      const url = s._href.startsWith("http") ? s._href : `https://www.procyclingstats.com/${s._href}`;
      const res = await fetch(url, { headers: PCS_HEADERS });
      if (!res.ok) continue;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      // Profiel-afbeelding
      if (doc) {
        const imgs = doc.querySelectorAll("img");
        for (const img of imgs) {
          const src = img.getAttribute("src") || "";
          if (src.includes("profile")) {
            profiles[s.stage_number] = src.startsWith("http") ? src : `https://www.procyclingstats.com/${src}`;
            break;
          }
        }
      }
      // Starttijd uit ruwe HTML
      const timeMatch = html.match(/Start\s*time[^]*?(\d{1,2}:\d{2})/i);
      if (timeMatch) startTimes[s.stage_number] = timeMatch[1];
    } catch {
      // Niet fataal
    }
  }
  return { profiles, startTimes };
}

// Haal foto's op voor renners die er nog geen hebben
async function fetchRiderPhotos(adminClient: any, competition_id: number, log: string[]) {
  const { data: ridersWithoutPhoto } = await adminClient
    .from("riders")
    .select("id,pcs_slug")
    .eq("competition_id", competition_id)
    .is("photo_url", null)
    .not("pcs_slug", "is", null);

  if (!ridersWithoutPhoto?.length) return;

  log.push(`📸 Foto's ophalen voor ${ridersWithoutPhoto.length} renners...`);
  let fetched = 0;

  for (const r of ridersWithoutPhoto) {
    try {
      const url = `https://www.procyclingstats.com/rider/${r.pcs_slug}`;
      const res = await fetch(url, { headers: PCS_HEADERS });
      if (!res.ok) continue;
      const html = await res.text();
      // Zoek rider foto: <img> in .riderProfileHeader of met rider naam in src
      const imgMatch = html.match(/rider\/([^"]+\.(?:jpeg|jpg|png|webp))/i);
      if (imgMatch) {
        const photoUrl = `https://www.procyclingstats.com/rider/${imgMatch[1]}`;
        await adminClient.from("riders").update({ photo_url: photoUrl }).eq("id", r.id);
        fetched++;
      }
    } catch { /* niet fataal */ }
    // Rate limit: 200ms tussen requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  log.push(`📸 ${fetched} foto's opgeslagen`);
}

function parseStartlist(doc: any) {
  const riders: any[] = [];
  const shirts: Record<string, string> = {};
  let autoBib = 1; // Tijdelijk bibnummer als PCS er nog geen heeft

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
      const pcsNib = parseInt(rider.querySelector(".bib")?.textContent?.trim() || "0");
      const bib = pcsNib || autoBib++;
      const riderLink = rider.querySelector("a");
      let name = riderLink?.textContent?.trim() || "";
      name = name.replace(/\s*\(.*\)$/, "");
      // PCS slug uit de href (bijv. "rider/tadej-pogacar" → "tadej-pogacar")
      const href = riderLink?.getAttribute("href") || "";
      const pcs_slug = href.replace(/^.*rider\//, "").trim() || null;
      if (bib && name) riders.push({ bib_number: bib, name, team: teamName, pcs_slug });
    }
  }

  return { riders, shirts };
}

// Haal bestaande rider-details op uit andere competities (foto, nationaliteit, specialiteiten, etc.)
async function enrichFromExisting(adminClient: any, pcs_slug: string | null): Promise<Record<string, any>> {
  if (!pcs_slug) return {};
  const { data } = await adminClient
    .from("riders")
    .select("photo_url,nationality,date_of_birth,weight_kg,height_m,specialty_one_day,specialty_gc,specialty_tt,specialty_sprint,specialty_climber,specialty_hills")
    .eq("pcs_slug", pcs_slug)
    .not("photo_url", "is", null)
    .limit(1)
    .maybeSingle();
  if (!data) {
    // Probeer zonder photo_url filter — pak gewoon de eerste met details
    const { data: fallback } = await adminClient
      .from("riders")
      .select("photo_url,nationality,date_of_birth,weight_kg,height_m,specialty_one_day,specialty_gc,specialty_tt,specialty_sprint,specialty_climber,specialty_hills")
      .eq("pcs_slug", pcs_slug)
      .limit(1)
      .maybeSingle();
    if (!fallback) return {};
    // Filter null values
    return Object.fromEntries(Object.entries(fallback).filter(([_, v]) => v != null));
  }
  return Object.fromEntries(Object.entries(data).filter(([_, v]) => v != null));
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

    const { pcs_url, competition_id, stage_id } = await req.json();
    if (!competition_id) {
      return new Response(JSON.stringify({ error: "Geen competitie geselecteerd" }), { status: 400, headers: corsHeaders });
    }

    // Check of het een eendagskoers is
    const { data: comp } = await adminClient
      .from("competitions").select("is_one_day,name").eq("id", competition_id).single();

    // Per-stage sync: sync één etappe met eigen PCS URL (voor klassiekers-bundel)
    if (stage_id) {
      const { data: stage } = await adminClient
        .from("stages").select("id,stage_number,pcs_url,name").eq("id", stage_id).single();
      if (!stage?.pcs_url) {
        return new Response(JSON.stringify({ error: "Geen PCS URL ingesteld voor deze etappe" }), { status: 400, headers: corsHeaders });
      }

      const stageBaseUrl = stage.pcs_url.replace(/\/$/, "").replace(/\/(stages|startlist|gc|stage-\d+|results?|resuts)$/, "");
      const stageYear = parseInt(stageBaseUrl.match(/\/(\d{4})/)?.[1] || String(new Date().getFullYear()));
      const log: string[] = [];

      // Helper: parse race-info (zelfde als hieronder)
      function parseSingleRaceInfo(rawHtml: string) {
        const get = (label: string) => {
          const re = new RegExp(label + '[":]*\\s*(?:</div>)?\\s*<div[^>]*>\\s*([^<]+)', 'i');
          const m = rawHtml.match(re);
          return m ? m[1].trim() : null;
        };
        return {
          date: get('Startdate') || get('Date'),
          startTime: get('Start time'),
          avgSpeed: get('Avg\\.\\s*speed winner') || get('Avg\\.\\s*speed'),
          classification: get('Classification'),
          raceCategory: get('Race category'),
          distance: get('Distance') || get('Total distance'),
          parcoursType: get('Parcours type'),
          profileScore: get('ProfileScore'),
          verticalMeters: get('Vertical meters'),
          departure: get('Departure'),
          arrival: get('Arrival'),
          startlistQuality: get('Startlist quality score'),
          avgTemperature: get('Avg\\.\\s*temperature'),
        };
      }

      // 1. Race-info ophalen
      log.push(`📅 Race-info ophalen voor ${stage.name}...`);
      try {
        const pcsRes = await fetch(stageBaseUrl, { headers: PCS_HEADERS });
        if (!pcsRes.ok) throw new Error(`PCS gaf status ${pcsRes.status}`);
        const rawHtml = await pcsRes.text();
        const overviewDoc = new DOMParser().parseFromString(rawHtml, "text/html");
        let info = parseSingleRaceInfo(rawHtml);

        // Probeer /result pagina voor extra info
        if (!info.startTime && !info.departure) {
          try {
            const resultRes = await fetch(stageBaseUrl + "/result", { headers: PCS_HEADERS });
            if (resultRes.ok) {
              const resultInfo = parseSingleRaceInfo(await resultRes.text());
              for (const key of Object.keys(resultInfo) as (keyof typeof resultInfo)[]) {
                if (!info[key] && resultInfo[key]) (info as any)[key] = resultInfo[key];
              }
            }
          } catch { /* niet fataal */ }
        }

        // Datum parsen
        let dateISO = `${stageYear}-01-01`;
        if (info.date) {
          const isoMatch = info.date.match(/(\d{4}-\d{2}-\d{2})/);
          if (isoMatch) dateISO = isoMatch[1];
          else {
            const longMatch = info.date.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
            if (longMatch) {
              const months: Record<string, string> = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
              const m = months[longMatch[2].toLowerCase()];
              if (m) dateISO = `${longMatch[3]}-${m}-${longMatch[1].padStart(2, '0')}`;
            }
          }
        }
        if (dateISO === `${stageYear}-01-01`) {
          const dm = rawHtml.match(new RegExp(`(${stageYear}-\\d{2}-\\d{2})`));
          if (dm) dateISO = dm[1];
        }

        const startTimeStr = info.startTime || "10:00";
        const timeParts = startTimeStr.split(":");
        const timeFormatted = timeParts.length === 2 ? `${timeParts[0].padStart(2, "0")}:${timeParts[1].padStart(2, "0")}` : "12:00";
        const startTime = new Date(`${dateISO}T${timeFormatted}:00${cetOffsetForDate(dateISO)}`);
        const distance_km = info.distance ? parseFloat(info.distance) || null : null;
        const durationHours = distance_km ? (distance_km / 40) + 1 : 6;
        const estimatedEnd = new Date(startTime.getTime() + durationHours * 3600 * 1000);

        // Profiel-afbeelding
        let profileUrl = null;
        if (overviewDoc) {
          const imgs = overviewDoc.querySelectorAll("img");
          for (const img of imgs) {
            const src = img.getAttribute("src") || "";
            if (src.includes("profile")) {
              profileUrl = src.startsWith("http") ? src : `https://www.procyclingstats.com/${src}`;
              break;
            }
          }
        }

        // Stage updaten
        const updateData: any = {
          date: dateISO,
          distance_km,
          departure: info.departure || null,
          arrival: info.arrival || null,
          profile_image_url: profileUrl,
          classification: info.classification || null,
          race_category: info.raceCategory || null,
          parcours_type: info.parcoursType || null,
          profile_score: info.profileScore ? parseInt(info.profileScore) || null : null,
          vertical_meters: info.verticalMeters ? parseInt(info.verticalMeters) || null : null,
          avg_speed_winner: info.avgSpeed || null,
          startlist_quality_score: info.startlistQuality ? parseInt(info.startlistQuality) || null : null,
          avg_temperature: info.avgTemperature || null,
          estimated_end_time: estimatedEnd.toISOString(),
        };
        if (startTimeStr && startTimeStr !== "0:00") {
          updateData.start_time = startTime.toISOString();
          updateData.deadline = startTime.toISOString();
        }
        await adminClient.from("stages").update(updateData).eq("id", stage_id);
        log.push(`✅ Etappe ${stage.stage_number}: datum=${dateISO}, ${distance_km || '?'}km, ${info.departure || '?'} → ${info.arrival || '?'}`);
      } catch (e) {
        log.push(`⚠️ Race-info: ${(e as Error).message}`);
      }

      // 2. Startlijst ophalen en riders mergen in competitie
      log.push("🚴 Startlijst ophalen...");
      let shirts: Record<string, string> = {};
      try {
        const startDoc = await fetchPCS(stageBaseUrl + "/startlist");
        const result = parseStartlist(startDoc);
        shirts = result.shirts;
        log.push(`✅ ${result.riders.length} renners + ${Object.keys(shirts).length} team shirts gevonden`);

        // Riders mergen op pcs_slug (bestaande updaten, nieuwe toevoegen)
        // Track rider IDs voor stage_riders koppeling
        const stageRiderIds: number[] = [];
        let ridersSaved = 0, ridersUpdated = 0;
        for (const r of result.riders) {
          try {
            let existing = null;
            if (r.pcs_slug) {
              const { data } = await adminClient
                .from("riders").select("id,bib_number")
                .eq("competition_id", competition_id)
                .eq("pcs_slug", r.pcs_slug)
                .maybeSingle();
              existing = data;
            }
            if (!existing) {
              // Niet op bib zoeken — bij klassiekers wisselen bibnummers per koers
              // Nieuwe renner toevoegen met uniek bibnummer
              // Vind hoogste bestaande bibnummer in competitie
              const { data: maxBib } = await adminClient
                .from("riders").select("bib_number")
                .eq("competition_id", competition_id)
                .order("bib_number", { ascending: false })
                .limit(1)
                .maybeSingle();
              const nextBib = (maxBib?.bib_number || 0) + 1;
              const enriched = await enrichFromExisting(adminClient, r.pcs_slug);
              const { data: inserted } = await adminClient
                .from("riders").insert({ ...enriched, ...r, bib_number: nextBib, competition_id })
                .select("id").maybeSingle();
              if (inserted?.id) stageRiderIds.push(inserted.id);
              ridersSaved++;
            } else {
              // Update naam/team (bib_number behouden — is intern)
              await adminClient.from("riders").update({ name: r.name, team: r.team, pcs_slug: r.pcs_slug }).eq("id", existing.id);
              stageRiderIds.push(existing.id);
              ridersUpdated++;
            }
          } catch (e) {
            log.push(`⚠️ ${r.name}: ${(e as Error).message}`);
          }
        }
        log.push(`🚴 Renners: ${ridersSaved} nieuw, ${ridersUpdated} bijgewerkt`);

        // Koppel renners aan deze specifieke etappe (stage_riders)
        if (stageRiderIds.length > 0) {
          try {
            // Verwijder oude koppeling voor deze etappe en herlaad
            await adminClient.from("stage_riders").delete().eq("stage_id", stage_id);
            const stageRiderRows = stageRiderIds.map(rider_id => ({ stage_id, rider_id }));
            await adminClient.from("stage_riders").insert(stageRiderRows);
            log.push(`✅ ${stageRiderIds.length} renners gekoppeld aan etappe ${stage.stage_number}`);
          } catch (e) {
            log.push(`⚠️ stage_riders: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        log.push(`⚠️ Startlijst: ${(e as Error).message}`);
      }

      await adminClient.from("competitions").update({ last_synced_at: new Date().toISOString() }).eq("id", competition_id);

      return new Response(JSON.stringify({ success: true, log, shirts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normale competitie-sync (grote ronde of losse eendagskoers)
    if (!pcs_url || !pcs_url.includes("procyclingstats.com")) {
      return new Response(JSON.stringify({ error: "Ongeldige PCS URL" }), { status: 400, headers: corsHeaders });
    }

    const baseUrl = pcs_url.replace(/\/$/, "").replace(/\/(stages|startlist|gc|stage-\d+|results?|resuts)$/, "");
    const raceYear = parseInt(baseUrl.match(/\/(\d{4})/)?.[1] || String(new Date().getFullYear()));

    const log: string[] = [];

    // 1. Fetch & parse stages
    log.push("📅 Etappes ophalen...");
    let stages: any[] = [];

    // Helper: parse alle race-info uit ruwe PCS HTML
    function parseRaceInfo(rawHtml: string) {
      const get = (label: string) => {
        // PCS structuur: <div>Label:</div><div>Value</div>
        const re = new RegExp(label + '[":]*\\s*(?:</div>)?\\s*<div[^>]*>\\s*([^<]+)', 'i');
        const m = rawHtml.match(re);
        return m ? m[1].trim() : null;
      };
      return {
        date: get('Startdate') || get('Date'),
        startTime: get('Start time'),
        avgSpeed: get('Avg\\.\\s*speed winner') || get('Avg\\.\\s*speed'),
        classification: get('Classification'),
        raceCategory: get('Race category'),
        distance: get('Distance') || get('Total distance'),
        parcoursType: get('Parcours type'),
        profileScore: get('ProfileScore'),
        verticalMeters: get('Vertical meters'),
        departure: get('Departure'),
        arrival: get('Arrival'),
        startlistQuality: get('Startlist quality score'),
        avgTemperature: get('Avg\\.\\s*temperature'),
      };
    }

    if (comp?.is_one_day) {
      // Eendagskoers: haal alle info van de race-overzichtspagina
      try {
        const pcsRes = await fetch(baseUrl, { headers: PCS_HEADERS });
        if (!pcsRes.ok) throw new Error(`PCS gaf status ${pcsRes.status}`);
        const rawHtml = await pcsRes.text();
        const overviewDoc = new DOMParser().parseFromString(rawHtml, "text/html");

        let info = parseRaceInfo(rawHtml);

        // Als de overzichtspagina weinig info heeft, probeer de /result pagina
        if (!info.startTime && !info.departure) {
          try {
            const resultRes = await fetch(baseUrl + "/result", { headers: PCS_HEADERS });
            if (resultRes.ok) {
              const resultHtml = await resultRes.text();
              const resultInfo = parseRaceInfo(resultHtml);
              // Vul ontbrekende velden aan
              for (const key of Object.keys(resultInfo) as (keyof typeof resultInfo)[]) {
                if (!info[key] && resultInfo[key]) (info as any)[key] = resultInfo[key];
              }
              log.push(`📄 Extra info van /result pagina opgehaald`);
            }
          } catch { /* niet fataal */ }
        }
        log.push(`📋 PCS info: ${JSON.stringify(info)}`);

        // Datum
        let dateISO = `${raceYear}-01-01`;
        if (info.date) {
          const isoMatch = info.date.match(/(\d{4}-\d{2}-\d{2})/);
          if (isoMatch) dateISO = isoMatch[1];
          else {
            // "29 March 2026" format
            const longMatch = info.date.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
            if (longMatch) {
              const months: Record<string, string> = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
              const m = months[longMatch[2].toLowerCase()];
              if (m) dateISO = `${longMatch[3]}-${m}-${longMatch[1].padStart(2, '0')}`;
            }
          }
        }
        // Fallback datum via regex
        if (dateISO === `${raceYear}-01-01`) {
          const dm = rawHtml.match(new RegExp(`(${raceYear}-\\d{2}-\\d{2})`));
          if (dm) dateISO = dm[1];
        }

        const startTimeStr = info.startTime || "10:00";
        const distance_km = info.distance ? parseFloat(info.distance) || null : null;

        // Profiel-afbeelding
        let profileUrl = null;
        if (overviewDoc) {
          const imgs = overviewDoc.querySelectorAll("img");
          for (const img of imgs) {
            const src = img.getAttribute("src") || "";
            if (src.includes("profile")) {
              profileUrl = src.startsWith("http") ? src : `https://www.procyclingstats.com/${src}`;
              break;
            }
          }
        }

        stages = [{
          stage_number: 1,
          name: comp.name || "Eendagskoers",
          date: dateISO,
          stage_type: "flat",
          distance_km,
          departure: info.departure || null,
          arrival: info.arrival || null,
          profile_image_url: profileUrl,
          classification: info.classification || null,
          race_category: info.raceCategory || null,
          parcours_type: info.parcoursType || null,
          profile_score: info.profileScore ? parseInt(info.profileScore) || null : null,
          vertical_meters: info.verticalMeters ? parseInt(info.verticalMeters) || null : null,
          avg_speed_winner: info.avgSpeed || null,
          startlist_quality_score: info.startlistQuality ? parseInt(info.startlistQuality) || null : null,
          avg_temperature: info.avgTemperature || null,
          _startTime: startTimeStr,
        }];
        log.push(`✅ 1 etappe — datum: ${dateISO}, start: ${startTimeStr}, ${distance_km || '?'}km, ${info.departure || '?'} → ${info.arrival || '?'}, profiel: ${info.profileScore || '?'}, vert: ${info.verticalMeters || '?'}m`);
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

    // 3. Fetch stage details (profielen + starttijden)
    let stageProfiles: Record<number, string> = {};
    let stageStartTimes: Record<number, string> = {};
    if (stages.length > 0 && !comp?.is_one_day) {
      log.push("🏔️ Etappedetails ophalen...");
      try {
        const details = await fetchStageDetails(stages);
        stageProfiles = details.profiles;
        stageStartTimes = details.startTimes;
        log.push(`✅ ${Object.keys(stageProfiles).length} profielen, ${Object.keys(stageStartTimes).length} starttijden`);
      } catch (e) {
        log.push(`⚠️ Details: ${e.message}`);
      }
    }

    // 4. Save stages (upsert: update bestaande, insert nieuwe)
    let stagesSaved = 0, stagesUpdated = 0;
    for (const s of stages) {
      // Starttijd: uit PCS (per etappe of eendags) of fallback 12:00
      const rawTime = s._startTime || stageStartTimes[s.stage_number] || "";
      const hasRealTime = rawTime && rawTime !== "0:00";
      let timeStr = "12:00";
      if (hasRealTime) {
        const timeParts = rawTime.split(":");
        if (timeParts.length === 2) {
          timeStr = `${timeParts[0].padStart(2, "0")}:${timeParts[1].padStart(2, "0")}`;
        }
      }
      const dateStr = s.date && s.date.match(/^\d{4}-\d{2}-\d{2}$/) ? s.date : `${raceYear}-01-01`;
      const startTime = new Date(`${dateStr}T${timeStr}:00${cetOffsetForDate(dateStr)}`);
      if (isNaN(startTime.getTime())) {
        log.push(`⚠️ Etappe ${s.stage_number}: ongeldige datum "${s.date}" / tijd "${timeStr}", overgeslagen`);
        continue;
      }
      // ETA: start + (afstand / 40 km/u) + 1 uur buffer voor PCS verwerking
      const durationHours = s.distance_km ? (s.distance_km / 40) + 1 : 6;
      const estimatedEnd = new Date(startTime.getTime() + durationHours * 3600 * 1000);
      const { _href, _startTime, profile_image_url, date: _date, ...stageData } = s; // interne velden apart
      const stageRow = {
        ...stageData,
        date: dateStr,
        profile_image_url: profile_image_url || stageProfiles[s.stage_number] || null,
        start_time: startTime.toISOString(),
        deadline: startTime.toISOString(),
        estimated_end_time: estimatedEnd.toISOString(),
        locked: false,
        competition_id,
      };
      // Check of etappe al bestaat
      const { data: existing } = await adminClient
        .from("stages")
        .select("id")
        .eq("competition_id", competition_id)
        .eq("stage_number", s.stage_number)
        .maybeSingle();
      // Log alle data die gesynct wordt
      log.push(`📋 Etappe ${s.stage_number}: datum=${s.date}, naam=${s.name}, afstand=${s.distance_km || '?'}km, start=${s.departure || '?'}, finish=${s.arrival || '?'}, profiel=${profile_image_url || stageProfiles[s.stage_number] ? '✅' : '❌'}, ETA=${estimatedEnd.toISOString()}, ${existing ? 'UPDATE' : 'NIEUW'}`);
      try {
        if (existing) {
          // Behoud locked, competition_id, en start_time/deadline als we geen echte tijd hebben
          const { locked, competition_id: _cid, ...updateData } = stageRow;
          if (!hasRealTime) {
            delete (updateData as any).start_time;
            delete (updateData as any).deadline;
          }
          await adminClient.from("stages").update(updateData).eq("id", existing.id);
          stagesUpdated++;
        } else {
          await adminClient.from("stages").insert(stageRow);
          stagesSaved++;
        }
      } catch (e) {
        log.push(`⚠️ Etappe ${s.stage_number}: ${(e as Error).message}`);
      }
    }
    log.push(`📅 Etappes: ${stagesSaved} nieuw, ${stagesUpdated} bijgewerkt`);

    // 5. Save riders (match op pcs_slug of bib_number, update bestaande)
    let ridersSaved = 0, ridersUpdated = 0;
    for (const r of riders) {
      try {
        // Zoek eerst op pcs_slug (stabiel), dan op bib_number
        let existing = null;
        if (r.pcs_slug) {
          const { data } = await adminClient
            .from("riders").select("id")
            .eq("competition_id", competition_id)
            .eq("pcs_slug", r.pcs_slug)
            .maybeSingle();
          existing = data;
        }
        if (!existing) {
          const { data } = await adminClient
            .from("riders").select("id")
            .eq("competition_id", competition_id)
            .eq("bib_number", r.bib_number)
            .maybeSingle();
          existing = data;
        }
        if (existing) {
          // Update bestaande renner (bibnummer kan veranderd zijn)
          await adminClient.from("riders").update({ ...r }).eq("id", existing.id);
          ridersUpdated++;
        } else {
          // Neem details over van dezelfde renner in andere competities
          const enriched = await enrichFromExisting(adminClient, r.pcs_slug);
          await adminClient.from("riders").insert({ ...enriched, ...r, competition_id });
          ridersSaved++;
        }
      } catch (e) {
        log.push(`⚠️ ${r.name}: ${(e as Error).message}`);
      }
    }
    log.push(`🚴 Renners: ${ridersSaved} nieuw, ${ridersUpdated} bijgewerkt`);

    // Foto's worden apart opgehaald (te traag voor 1 request)

    // Update last_synced_at
    await adminClient.from("competitions").update({ last_synced_at: new Date().toISOString() }).eq("id", competition_id);

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
