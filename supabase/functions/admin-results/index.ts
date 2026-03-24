import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });

    // Check admin
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await adminClient
      .from("profiles").select("is_admin").eq("id", user.id).single();

    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: corsHeaders });
    }

    const { stage_id, results } = await req.json();
    // results: [{ rider_id, time_seconds, points, mountain_points, dnf }]

    if (!stage_id || !results?.length) {
      return new Response(JSON.stringify({ error: "stage_id and results array required" }), { status: 400, headers: corsHeaders });
    }

    // Upsert all results
    const rows = results.map((r: any) => ({
      stage_id,
      rider_id: r.rider_id,
      time_seconds: r.time_seconds,
      points: r.points || 0,
      mountain_points: r.mountain_points || 0,
      dnf: r.dnf || false,
    }));

    const { error } = await adminClient
      .from("stage_results")
      .upsert(rows, { onConflict: "stage_id,rider_id" });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
    }

    // Lock the stage
    await adminClient.from("stages").update({ locked: true }).eq("id", stage_id);

    return new Response(JSON.stringify({ success: true, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
