import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async (req) => {
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: expectedSecret } = await adminClient.rpc("get_cron_secret");
  if (!expectedSecret || req.headers.get("x-cron-secret") !== expectedSecret)
    return new Response("Unauthorized", { status: 401 });
  const res = await fetch("https://www.procyclingstats.com/rider/tadej-pogacar", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept": "text/html" },
  });
  const html = await res.text();
  // Zoek alle career-points URLs
  const careers = [...html.matchAll(/career-points[^"']*/gi)].map(m => m[0]);
  const unique = [...new Set(careers)];
  // Toon ook de sectie rondom elk career-points patroon
  const sections: Record<string, string> = {};
  for (const u of unique) {
    const idx = html.indexOf(u);
    if (idx !== -1) sections[u] = html.slice(idx, idx + 250);
  }
  return new Response(JSON.stringify({ unique, sections }), { headers: { "Content-Type": "application/json" } });
});
