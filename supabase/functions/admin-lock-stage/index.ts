import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Can be called by cron or manually by admin to lock stages past deadline
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Lock all stages past their deadline
    const { data, error } = await adminClient
      .from("stages")
      .update({ locked: true })
      .lt("deadline", new Date().toISOString())
      .eq("locked", false)
      .select();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    // Rad van Fortuin: wijs random renners toe voor nieuw vergrendelde etappes
    const randomResults = [];
    if (data?.length) {
      for (const stage of data) {
        const { data: result, error: rpcError } = await adminClient
          .rpc("assign_random_riders", { p_stage_id: stage.id });
        randomResults.push({ stage_id: stage.id, result, error: rpcError?.message });
      }
    }

    return new Response(JSON.stringify({ locked_stages: data?.length || 0, random_assignments: randomResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
