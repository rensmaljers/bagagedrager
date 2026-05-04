import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PCS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.5",
};

const SPEC_MAP: Record<string, string> = {
  'one.*day': 'specialty_one_day',
  'gc': 'specialty_gc',
  'tt': 'specialty_tt',
  'sprint': 'specialty_sprint',
  'climber': 'specialty_climber',
  'hill': 'specialty_hills',
};

function parseSpecialties(html: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [pattern, field] of Object.entries(SPEC_MAP)) {
    const m = html.match(new RegExp(pattern + '[^>]*>\\s*(\\d+)', 'i'));
    if (m) result[field] = parseInt(m[1]);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Beveiligd door CRON_SECRET — alleen aanroepbaar door pg_cron
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Haal 50 unieke pcs_slugs op, oudste specialty_refreshed_at eerst
  const { data: rows } = await adminClient
    .from("riders")
    .select("pcs_slug")
    .not("pcs_slug", "is", null)
    .order("specialty_refreshed_at", { ascending: true, nullsFirst: true })
    .limit(50);

  if (!rows?.length) {
    return new Response(JSON.stringify({ processed: 0, remaining: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Dedupliceer slugs
  const slugs = [...new Set(rows.map(r => r.pcs_slug as string))];

  // Tel hoeveel er nog over zijn na deze batch
  const { count: totalCount } = await adminClient
    .from("riders")
    .select("pcs_slug", { count: "exact", head: true })
    .not("pcs_slug", "is", null);

  let processed = 0;

  for (const slug of slugs) {
    try {
      const url = `https://www.procyclingstats.com/rider/${slug}`;
      const res = await fetch(url, { headers: PCS_HEADERS });
      if (!res.ok) continue;
      const html = await res.text();

      const specs = parseSpecialties(html);
      if (Object.keys(specs).length === 0) continue;

      // Update alle rider-rijen met deze slug (over alle competities)
      await adminClient
        .from("riders")
        .update({ ...specs, specialty_refreshed_at: new Date().toISOString() })
        .eq("pcs_slug", slug);

      processed++;
    } catch {
      // Sla over bij fout, probeer volgende
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const remaining = Math.max((totalCount ?? 0) - rows.length, 0);

  return new Response(JSON.stringify({ processed, remaining }), {
    headers: { "Content-Type": "application/json" },
  });
});
