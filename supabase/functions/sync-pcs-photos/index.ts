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
        if (!res.ok) { log.push(`⚠️ ${r.name}: HTTP ${res.status}`); continue; }
        const html = await res.text();

        // Zoek rider foto
        const imgMatch = html.match(/rider\/([^"]+\.(?:jpeg|jpg|png|webp))/i);
        if (imgMatch) {
          const photoUrl = `https://www.procyclingstats.com/rider/${imgMatch[1]}`;
          await adminClient.from("riders").update({ photo_url: photoUrl }).eq("id", r.id);
          fetched++;
        } else {
          // Geen foto gevonden, markeer met lege string zodat we niet opnieuw proberen
          await adminClient.from("riders").update({ photo_url: "" }).eq("id", r.id);
          log.push(`⚠️ ${r.name}: geen foto gevonden`);
        }
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
