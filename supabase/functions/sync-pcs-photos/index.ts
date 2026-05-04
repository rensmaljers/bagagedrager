import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PCS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.5",
};

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

    const { competition_id } = await req.json();
    if (!competition_id) {
      return new Response(JSON.stringify({ error: "Geen competitie geselecteerd" }), { status: 400, headers: corsHeaders });
    }

    // Reset alle niet-URL foto's (lege string, "none", etc.) naar null
    await adminClient
      .from("riders")
      .update({ photo_url: null })
      .eq("competition_id", competition_id)
      .not("photo_url", "like", "http%");

    // Haal renners zonder foto op (max 25 per batch)
    const { data: ridersWithoutPhoto } = await adminClient
      .from("riders")
      .select("id,pcs_slug,name")
      .eq("competition_id", competition_id)
      .is("photo_url", null)
      .not("pcs_slug", "is", null)
      .limit(25);

    if (!ridersWithoutPhoto?.length) {
      return new Response(JSON.stringify({
        success: true,
        fetched: 0,
        remaining: 0,
        message: "Alle renners hebben al een foto",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Tel hoeveel er nog over zijn
    const { count } = await adminClient
      .from("riders")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", competition_id)
      .is("photo_url", null)
      .not("pcs_slug", "is", null);

    let fetched = 0;
    const log: string[] = [];

    for (const r of ridersWithoutPhoto) {
      try {
        const url = `https://www.procyclingstats.com/rider/${r.pcs_slug}`;
        const res = await fetch(url, { headers: PCS_HEADERS });
        if (!res.ok) { log.push(`⚠️ ${r.name}: HTTP ${res.status} van ${url}`); continue; }
        const html = await res.text();

        // Parse alle renner-info uit de HTML
        const update: Record<string, any> = {};

        // Debug: log voor alle renners
        const allImgs = [...html.matchAll(/src="([^"]*\.(?:jpeg|jpg|png|webp))"/gi)].map(m => m[1]).slice(0, 8);
        log.push(`🔍 ${r.name} (${html.length} bytes): ${allImgs.length} imgs: ${allImgs.join(' | ')}`);

        // Foto — PCS gebruikt paden als "images/riders/bp/xx/name.jpeg"
        const imgMatch = html.match(/images\/riders\/[^"]+\.(?:jpeg|jpg|png|webp)/i);
        if (imgMatch) {
          update.photo_url = imgMatch[0].startsWith("http") ? imgMatch[0] : `https://www.procyclingstats.com/${imgMatch[0]}`;
        } else {
          const altMatch = html.match(/src="([^"]*\.(?:jpeg|jpg|png|webp))"/i);
          if (altMatch && !altMatch[1].includes("logo") && !altMatch[1].includes("shirt") && !altMatch[1].includes("flag") && !altMatch[1].includes("icon")) {
            update.photo_url = altMatch[1].startsWith("http") ? altMatch[1] : `https://www.procyclingstats.com/${altMatch[1]}`;
          } else {
            update.photo_url = "none";
          }
        }

        // Nationaliteit
        const natMatch = html.match(/Nationality[^>]*>[^<]*<[^>]*>\s*([^<]+)/i);
        if (natMatch) update.nationality = natMatch[1].trim();

        // Geboortedatum
        const dobMatch = html.match(/(\d{1,2})(?:st|nd|rd|th)\s*(\w+)\s*(\d{4})/i);
        if (dobMatch) {
          const months: Record<string, string> = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
          const m = months[dobMatch[2].toLowerCase()];
          if (m) update.date_of_birth = `${dobMatch[3]}-${m}-${dobMatch[1].padStart(2, '0')}`;
        }

        // Gewicht & lengte
        const weightMatch = html.match(/Weight\s*(?:<[^>]*>)*\s*(\d+)\s*kg/i);
        if (weightMatch) update.weight_kg = parseInt(weightMatch[1]);
        const heightMatch = html.match(/Height\s*(?:<[^>]*>)*\s*([\d.]+)\s*m/i);
        if (heightMatch) update.height_m = parseFloat(heightMatch[1]);

        // Specialiteiten — PCS gebruikt career-points-{discipline} met w{0-100} breedte als score
        const specMap: Record<string, string> = {
          'career-points-one-day-races': 'specialty_one_day',
          'career-points-gc':            'specialty_gc',
          'career-points-time-trial':    'specialty_tt',
          'career-points-sprint':        'specialty_sprint',
          'career-points-climbers':      'specialty_climber',
        };
        for (const [pattern, field] of Object.entries(specMap)) {
          const specMatch = html.match(new RegExp(pattern + '[\\s\\S]{0,300}?<div class="w(\\d+)'));
          if (specMatch) update[field] = parseInt(specMatch[1]);
        }

        await adminClient.from("riders").update(update).eq("id", r.id);
        if (update.photo_url && update.photo_url !== "none") fetched++;
        else if (update.photo_url === "none") log.push(`⚠️ ${r.name}: geen foto`);
      } catch (e) {
        log.push(`❌ ${r.name}: ${(e as Error).message}`);
      }
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    const remaining = (count || 0) - ridersWithoutPhoto.length;

    return new Response(JSON.stringify({
      success: true,
      fetched,
      remaining: Math.max(remaining, 0),
      log,
      message: remaining > 0
        ? `${fetched} foto's opgehaald, nog ${remaining} te gaan — klik nogmaals`
        : `${fetched} foto's opgehaald, klaar!`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
