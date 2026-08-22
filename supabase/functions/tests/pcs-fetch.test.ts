import { assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchPcsPage } from "../_shared/pcs-fetch.ts";

// Fetch-stub die een reeks uitkomsten afspeelt: nummer = HTTP-status,
// "netwerk" = TypeError zoals een echte fetch-failure. Laatste uitkomst
// herhaalt. Registreert de aangeroepen URL's zodat we het proxy-pad zien.
function fetchStub(outcomes: (number | "netwerk")[]) {
  let calls = 0;
  const urls: string[] = [];
  const fn = ((url: string | URL | Request, _init?: RequestInit) => {
    urls.push(String(url));
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls++;
    if (outcome === "netwerk") return Promise.reject(new TypeError("error sending request"));
    return Promise.resolve(new Response("ok", { status: outcome }));
  }) as typeof fetch;
  return { fn, getCalls: () => calls, urls };
}

Deno.test("tijdelijke 503 wordt geretried en slaagt alsnog", async () => {
  const stub = fetchStub([503, 503, 200]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(stub.getCalls(), 3);
});

Deno.test("netwerkfout wordt geretried", async () => {
  const stub = fetchStub(["netwerk", 200]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(stub.getCalls(), 2);
});

Deno.test("429 (rate limit) wordt geretried", async () => {
  const stub = fetchStub([429, 200]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(stub.getCalls(), 2);
});

Deno.test("deterministische 404 komt direct terug zonder retry of proxy", async () => {
  const stub = fetchStub([404]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1 });
  assertEquals(res.status, 404);
  assertEquals(stub.getCalls(), 1);
});

Deno.test("403 (Cloudflare-blok) valt direct terug op de renderproxy", async () => {
  const stub = fetchStub([403, 200]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(stub.getCalls(), 2); // geen directe retries na 403
  assertStringIncludes(stub.urls[1], "https://r.jina.ai/https://pcs/x");
});

Deno.test("403 waarbij ook de proxy faalt geeft het 403-blok terug", async () => {
  const stub = fetchStub([403, 500, 500]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1, proxyRetries: 1 });
  assertEquals(res.status, 403); // callers rapporteren "PCS status 403"
  assertEquals(stub.getCalls(), 3); // 1 direct + 2 proxy-pogingen
});

Deno.test("aanhoudende 503 probeert daarna de proxy en slaagt", async () => {
  const stub = fetchStub([503, 503, 503, 200]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, retries: 2, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(stub.getCalls(), 4); // 3 direct + 1 proxy
  assertStringIncludes(stub.urls[3], "https://r.jina.ai/");
});

Deno.test("alles faalt: duidelijke fout met proxy-vermelding", async () => {
  const stub = fetchStub([503]);
  await assertRejects(
    () => fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, retries: 2, baseDelayMs: 1, proxyRetries: 1 }),
    Error,
    "proxy status 503 (direct + proxy geprobeerd)",
  );
  assertEquals(stub.getCalls(), 5); // 3 direct + 2 proxy
});
