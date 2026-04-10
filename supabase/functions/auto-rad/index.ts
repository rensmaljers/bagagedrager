import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Draait elke minuut via Supabase cron schedule.
// Zoekt etappes waarvan de deadline verstreken is maar het Rad nog niet gedraaid heeft,
// voert assign_random_riders uit en zet rad_assigned = true.

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Haal etappes op waarvan deadline verstreken is en rad nog niet gedraaid heeft
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, competition_id, deadline")
    .lt("deadline", new Date().toISOString())
    .eq("rad_assigned", false);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!stages || stages.length === 0) {
    return new Response(JSON.stringify({ assigned: 0 }));
  }

  const results = [];
  for (const stage of stages) {
    const { data, error: rpcError } = await supabase.rpc("assign_random_riders", {
      p_stage_id: stage.id,
    });

    if (rpcError) {
      results.push({ stage_id: stage.id, error: rpcError.message });
      continue;
    }

    // Zet rad_assigned = true zodat het niet nog een keer draait
    await supabase
      .from("stages")
      .update({ rad_assigned: true })
      .eq("id", stage.id);

    results.push({ stage_id: stage.id, stage_number: stage.stage_number, ...data });
  }

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
