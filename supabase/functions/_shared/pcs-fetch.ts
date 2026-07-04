// Gedeelde PCS-fetch met retry + backoff.
// PCS/Cloudflare geeft af en toe een kortstondige 5xx of netwerkfout; één
// mislukte fetch betekende tot nu toe meteen een mislukte sync. Retry helpt
// alleen bij tijdelijke fouten: 5xx, 429 en netwerkfouten. Overige 4xx zijn
// deterministisch (verkeerde URL, echt blok) — die geven we direct terug.

const PCS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

export interface FetchPcsOptions {
  retries?: number;      // aantal héretries (totaal = retries + 1 pogingen)
  baseDelayMs?: number;  // backoff = poging × baseDelayMs (2s, 4s, ...)
  fetchFn?: typeof fetch; // injecteerbaar voor tests
}

export async function fetchPcsPage(url: string, opts: FetchPcsOptions = {}): Promise<Response> {
  const { retries = 2, baseDelayMs = 2000, fetchFn = fetch } = opts;
  let lastError = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * baseDelayMs));
    }
    try {
      const res = await fetchFn(url, { headers: PCS_HEADERS });
      if (res.ok) return res;
      // Deterministische 4xx (behalve 429): meteen teruggeven, retry is zinloos
      if (res.status < 500 && res.status !== 429) return res;
      lastError = `PCS status ${res.status}`;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  throw new Error(`${lastError} (na ${retries + 1} pogingen)`);
}
