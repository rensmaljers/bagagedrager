import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function buildReminderEmail(name: string, stageName: string, deadlineStr: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#111111;padding:24px 32px;text-align:center;">
            <span style="font-size:28px;">🚴</span>
            <span style="display:block;color:#f5c518;font-size:20px;font-weight:700;letter-spacing:-0.5px;margin-top:6px;">Bagagedrager</span>
            <span style="display:block;color:#888;font-size:12px;margin-top:2px;">Het Wielerspel</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#444;">Hoi <strong>${name}</strong>,</p>
            <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
              Je hebt nog <strong>geen renner gekozen</strong> voor<br>
              <span style="font-size:18px;font-weight:700;color:#111;">${stageName}</span>
            </p>
            <!-- Deadline box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#fff8e1;border-left:4px solid #f5c518;border-radius:4px;padding:14px 16px;">
                  <span style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Deadline</span><br>
                  <span style="font-size:15px;font-weight:600;color:#111;">${deadlineStr}</span>
                </td>
              </tr>
            </table>
            <!-- CTA -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f5c518;border-radius:8px;">
                  <a href="${appUrl}/#pick" style="display:inline-block;padding:13px 28px;color:#111111;font-weight:700;font-size:15px;text-decoration:none;">Maak je keuze →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#aaa;line-height:1.5;">
              Je ontvangt deze mail omdat je e-mailherinneringen hebt ingeschakeld.<br>
              Uitschakelen kan via <a href="${appUrl}/#account" style="color:#888;">Account → Deadline herinneringen</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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
          from: "Bagagedrager <noreply@bagagedrager.app>",
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
