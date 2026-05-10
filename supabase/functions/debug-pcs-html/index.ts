import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async (req) => {
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: expectedSecret } = await adminClient.rpc("get_cron_secret");
  if (!expectedSecret || req.headers.get("x-cron-secret") !== expectedSecret)
    return new Response("Unauthorized", { status: 401 });
  const { url, keywords } = await req.json();
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept": "text/html" },
  });
  const html = await res.text();
  const found: Record<string, string> = {};
  for (const kw of (keywords as string[])) {
    const idx = html.toLowerCase().indexOf(kw.toLowerCase());
    if (idx !== -1) found[kw] = html.slice(Math.max(0, idx - 50), idx + 300);
  }
  return new Response(JSON.stringify({ status: res.status, size: html.length, found }), { headers: { "Content-Type": "application/json" } });
});
