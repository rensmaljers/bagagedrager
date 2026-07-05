import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PCS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.5",
};

// PCS "Points per specialty"-blok: per <li> eerst de balk (w{N}), dan de
// absolute careerpunten (xvalue), dan het label met discipline-link.
// We slaan de ABSOLUTE punten op — vergelijkbaar tussen renners, in
// tegenstelling tot de per-renner-genormaliseerde balkbreedte.
// Let op: de oude parser keek per label vooruit naar de eerstvolgende w{N},
// maar die hoort bij de VOLGENDE discipline — alle waarden zaten één plek
// verschoven (Pogačar: sprint=100, tt=4). Vandaar deze per-li-aanpak.
const SPEC_MAP: Record<string, string> = {
  'career-points-one-day-races': 'specialty_one_day',
  'career-points-gc':            'specialty_gc',
  'career-points-time-trial':    'specialty_tt',
  'career-points-sprint':        'specialty_sprint',
  'career-points-climbers':      'specialty_climber',
  'results/hills':               'specialty_hills',
};

// Nationaliteit staat op dezelfde renner-pagina die we toch al fetchen:
//   <div class="bold mr5" >Nationality:</div> ... <a  href="nation/slovenia">Slovenia</a>
// Let op de ruwe-HTML-eigenaardigheden: dubbele spatie in `<a  href` en
// spaties vóór sluit-`>` — vandaar \s+ en \s* (vastgelegd 5 juli 2026).
function parseNationality(html: string): string | null {
  const m = html.match(/Nationality:[\s\S]{0,300}?<a\s+href="nation\/[^"]*"\s*>([^<]+)<\/a>/);
  return m ? m[1].trim() : null;
}

function parseSpecialties(html: string): Record<string, number> {
  const result: Record<string, number> = {};
  // Let op: ruwe PCS-HTML heeft soms een spatie vóór de sluit-`>` (class="…" >)
  const re = /<div class="xvalue ac"\s*>\s*([\d.,]+)\s*<\/div>\s*<div class="xtitle"\s*>\s*<a\s+href="[^"]*?(career-points-one-day-races|career-points-gc|career-points-time-trial|career-points-sprint|career-points-climbers|results\/hills)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const field = SPEC_MAP[m[2]];
    const points = parseInt(m[1].replace(/[.,]/g, ""));
    if (field && !isNaN(points)) result[field] = points;
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Secret staat in DB — geen losse env var nodig
  const { data: expectedSecret } = await adminClient.rpc("get_cron_secret");
  if (!expectedSecret || req.headers.get("x-cron-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

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

  // Debug: laat zien wat de eerste fetch+parse oplevert (geen updates)
  const isDebug = new URL(req.url).searchParams.get("debug") === "1";
  if (isDebug) {
    const url = `https://www.procyclingstats.com/rider/${slugs[0]}`;
    const res = await fetch(url, { headers: PCS_HEADERS });
    const html = res.ok ? await res.text() : "";
    const bi = html.indexOf("career-points-climbers");
    return new Response(JSON.stringify({
      slug: slugs[0], status: res.status, htmlLength: html.length,
      hasBlock: html.includes("xvalue ac"), parsed: parseSpecialties(html),
      ctx: bi >= 0 ? html.slice(Math.max(0, bi - 350), bi + 60) : null,
    }), { headers: { "Content-Type": "application/json" } });
  }

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

      // Nationaliteit meenemen (zelfde pagina, gratis) — vult het landen-filter op de pick-pagina
      const nationality = parseNationality(html);

      // Update alle rider-rijen met deze slug (over alle competities)
      await adminClient
        .from("riders")
        .update({
          ...specs,
          ...(nationality ? { nationality } : {}),
          specialty_refreshed_at: new Date().toISOString(),
        })
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
