import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildReminderEmail } from "../_shared/email-template.ts";


// Draait elk uur.
// Stuurt een email naar spelers die nog geen keuze hebben gemaakt
// voor een etappe waarvan de deadline over 3.5–4.5 uur verstrijkt.

Deno.serve(async (req: Request) => {
  const cronSecret = req.headers.get("x-cron-secret");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Valideer cron secret
  const { data: cfg } = await supabase.rpc("get_cron_secret");
  if (!cronSecret || cronSecret !== cfg) {
    return new Response(JSON.stringify({ error: "Onbevoegd" }), { status: 401 });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY niet ingesteld" }), { status: 500 });
  }

  const appUrl = Deno.env.get("APP_URL") || "https://bagagedrager.app";

  const now = Date.now();
  const windowStart = new Date(now + 3.5 * 60 * 60 * 1000).toISOString();
  const windowEnd   = new Date(now + 4.5 * 60 * 60 * 1000).toISOString();

  // Etappes met deadline over 3.5–4.5 uur, nog geen email verstuurd
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, name, deadline, competition_id")
    .eq("email_sent", false)
    .gt("deadline", windowStart)
    .lt("deadline", windowEnd);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!stages?.length) return new Response(JSON.stringify({ sent: 0 }));

  const results = [];

  // Haal alle gebruikersemails op via admin API
  const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map<string, string>(
    (allUsers || []).filter((u: any) => u.email).map((u: any) => [u.id, u.email])
  );

  for (const stage of stages) {
    // Spelers in deze competitie die e-mailherinneringen willen
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("competition_id", stage.competition_id)
      .eq("email_reminders", true);

    // Keuzes al gemaakt voor deze etappe
    const { data: picks } = await supabase
      .from("picks")
      .select("user_id")
      .eq("stage_id", stage.id);

    const pickedIds = new Set((picks || []).map((p: any) => p.user_id));
    const unpicked = (profiles || []).filter((p: any) => !pickedIds.has(p.id));

    if (!unpicked.length) {
      await supabase.from("stages").update({ email_sent: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, sent: 0 });
      continue;
    }

    const deadline = new Date(stage.deadline);
    const deadlineStr = deadline.toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    });

    let sent = 0;
    for (const p of unpicked) {
      const email = emailById.get(p.id);
      if (!email) continue;

      const stageName = stage.name
        ? `Etappe ${stage.stage_number} — ${stage.name}`
        : `Etappe ${stage.stage_number}`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: Deno.env.get("EMAIL_FROM") || "Bagagedrager <onboarding@resend.dev>",
          to: email,
          subject: `⏰ Nog geen keuze voor ${stageName} — deadline over ~4 uur`,
          html: buildReminderEmail(p.display_name || "wielrenner", stageName, deadlineStr, appUrl),
        }),
      });

      if (res.ok) sent++;
    }

    await supabase.from("stages").update({ email_sent: true }).eq("id", stage.id);
    results.push({ stage_id: stage.id, stage_number: stage.stage_number, sent });
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
