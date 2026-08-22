// Gedeelde PCS-fetch met retry + backoff én een render-proxy-fallback.
// PCS/Cloudflare geeft af en toe een kortstondige 5xx of netwerkfout; retry
// helpt alleen bij tijdelijke fouten: 5xx, 429 en netwerkfouten. Overige 4xx
// zijn deterministisch (verkeerde URL, echt blok) — die geven we direct terug.
//
// Sinds 22 aug 2026 zet PCS een Cloudflare JS-challenge in die ook het
// datacenter-IP van Supabase blokkeert (403 "Just a moment..."). Daarom valt
// deze fetch bij een 403 (en bij uitgeputte retries) terug op de
// r.jina.ai-renderproxy, die de challenge in een echte browser oplost en de
// volledige HTML teruggeeft. De directe fetch blijft primair: sneller, en
// gratis als Cloudflare de teugels weer laat vieren.

const PCS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

const PROXY_PREFIX = "https://r.jina.ai/";

// JINA_API_KEY is optioneel (hogere rate limits); zonder key werkt de proxy
// ook. try/catch omdat tests zonder --allow-env draaien.
function jinaApiKey(): string | undefined {
  try {
    return Deno.env.get("JINA_API_KEY") ?? undefined;
  } catch {
    return undefined;
  }
}

export interface FetchPcsOptions {
  retries?: number;      // aantal héretries op het directe kanaal (totaal = retries + 1 pogingen)
  baseDelayMs?: number;  // backoff = poging × baseDelayMs (2s, 4s, ...)
  fetchFn?: typeof fetch; // injecteerbaar voor tests
  proxyRetries?: number; // aantal héretries op de proxy (totaal = proxyRetries + 1 pogingen)
}

export async function fetchPcsPage(url: string, opts: FetchPcsOptions = {}): Promise<Response> {
  const { retries = 2, baseDelayMs = 2000, fetchFn = fetch, proxyRetries = 1 } = opts;
  let lastError = "";
  let blockedRes: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * baseDelayMs));
    }
    try {
      const res = await fetchFn(url, { headers: PCS_HEADERS });
      if (res.ok) return res;
      // 403 = Cloudflare-blok: direct door naar de proxy, retry is zinloos
      if (res.status === 403) {
        blockedRes = res;
        break;
      }
      // Overige deterministische 4xx (behalve 429): meteen teruggeven
      if (res.status < 500 && res.status !== 429) return res;
      lastError = `PCS status ${res.status}`;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  // Direct kanaal geblokkeerd of uitgeput → renderproxy. X-No-Cache dwingt een
  // verse render af (uitslagen veranderen; jina cachet standaard).
  const proxyHeaders: Record<string, string> = {
    "X-Return-Format": "html",
    "X-No-Cache": "true",
  };
  const key = jinaApiKey();
  if (key) proxyHeaders["Authorization"] = `Bearer ${key}`;

  for (let attempt = 0; attempt <= proxyRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * baseDelayMs));
    }
    try {
      const res = await fetchFn(PROXY_PREFIX + url, { headers: proxyHeaders });
      if (res.ok) return res;
      lastError = `proxy status ${res.status}`;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  // Proxy hielp ook niet: geef het oorspronkelijke 403-blok terug (callers
  // rapporteren dan "PCS status 403") of gooi de laatste fout.
  if (blockedRes) return blockedRes;
  throw new Error(`${lastError} (direct + proxy geprobeerd)`);
}
