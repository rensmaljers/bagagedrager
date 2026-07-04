import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { parseStagePage } from "../_shared/pcs-parse.ts";
import { fetchPcsPage } from "../_shared/pcs-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // Fetch PCS page — gedeelde helper met retry/backoff bij 5xx/429/netwerkfout
    let pcsRes: Response;
    try {
      pcsRes = await fetchPcsPage(pcs_url);
    } catch (e) {
      return new Response(JSON.stringify({ error: `PCS niet bereikbaar: ${(e as Error).message}. Probeer het later opnieuw.` }), { status: 502, headers: corsHeaders });
    }

    if (!pcsRes.ok) {
      return new Response(JSON.stringify({ error: `PCS gaf status ${pcsRes.status}. Probeer het later opnieuw.` }), { status: 502, headers: corsHeaders });
    }

    const html = await pcsRes.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) {
      return new Response(JSON.stringify({ error: "Kon pagina niet parsen" }), { status: 500, headers: corsHeaders });
    }

    let results;
    try {
      results = parseStagePage(doc);
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      count: results.length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
