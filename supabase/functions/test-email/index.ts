import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildReminderEmail } from "../_shared/email-template.ts";

// Stuurt een test-e-mail naar de ingelogde admin (alleen voor admins).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Niet ingelogd" }), { status: 401, headers: corsHeaders });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Ongeldige sessie" }), { status: 401, headers: corsHeaders });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: "Geen toegang" }), { status: 403, headers: corsHeaders });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY niet ingesteld" }), { status: 500, headers: corsHeaders });
  }

  const appUrl = Deno.env.get("APP_URL") || "https://bagagedrager.app";
  const name = profile.display_name || "Admin";
  const stageName = "Etappe 99 — Testrit";
  const deadlineStr = new Date(Date.now() + 4 * 60 * 60 * 1000).toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Bagagedrager <noreply@bagagedrager.app>",
      to: user.email,
      subject: `⏰ Nog geen keuze voor ${stageName} — deadline over ~4 uur`,
      html: buildReminderEmail(name, stageName, deadlineStr, appUrl),
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `Resend fout: HTTP ${res.status}`, detail: body }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ sent: true, to: user.email }), {
    headers: corsHeaders,
  });
});
