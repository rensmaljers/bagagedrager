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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });

    const { stage_id, rider_id } = await req.json();
    if (!stage_id || !rider_id) {
      return new Response(JSON.stringify({ error: "stage_id and rider_id required" }), { status: 400, headers: corsHeaders });
    }

    // Use service role for validation queries
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check stage exists and deadline
    const { data: stage } = await adminClient
      .from("stages").select("*").eq("id", stage_id).single();

    if (!stage) return new Response(JSON.stringify({ error: "Stage not found" }), { status: 404, headers: corsHeaders });

    const now = new Date();
    const deadline = new Date(stage.deadline);
    const isLate = now > deadline || stage.locked;

    // Get all stages in this competition to scope the uniqueness check
    const { data: compStages } = await adminClient
      .from("stages").select("id").eq("competition_id", stage.competition_id);
    const compStageIds = compStages?.map(s => s.id) || [];

    // Check rider not already used by this user in this competition
    const { data: existingPicks } = await adminClient
      .from("picks").select("rider_id, stage_id").eq("user_id", user.id).in("stage_id", compStageIds);

    const alreadyUsed = existingPicks?.some(p => p.rider_id === rider_id && p.stage_id !== stage_id);
    if (alreadyUsed) {
      return new Response(JSON.stringify({ error: "Je hebt deze renner al gebruikt in een andere etappe" }), { status: 400, headers: corsHeaders });
    }

    // Check if user already picked for this stage (allow update before deadline)
    const existingPick = existingPicks?.find(p => p.stage_id === stage_id);
    if (existingPick && isLate) {
      return new Response(JSON.stringify({ error: "Stage is locked, cannot change pick" }), { status: 400, headers: corsHeaders });
    }

    // Upsert the pick
    const { data: pick, error: pickError } = await adminClient
      .from("picks")
      .upsert({
        user_id: user.id,
        stage_id,
        rider_id,
        is_late: isLate,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "user_id,stage_id" })
      .select()
      .single();

    if (pickError) {
      return new Response(JSON.stringify({ error: pickError.message }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      pick,
      warning: isLate ? "Pick submitted after deadline — late penalty applies" : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
