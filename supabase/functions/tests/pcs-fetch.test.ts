import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchPcsPage } from "../_shared/pcs-fetch.ts";

// Fetch-stub die een reeks uitkomsten afspeelt: nummer = HTTP-status,
// "netwerk" = TypeError zoals een echte fetch-failure.
function fetchStub(outcomes: (number | "netwerk")[]) {
  let calls = 0;
  const fn = ((_url: string, _init?: RequestInit) => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls++;
    if (outcome === "netwerk") return Promise.reject(new TypeError("error sending request"));
    return Promise.resolve(new Response("ok", { status: outcome }));
  }) as typeof fetch;
  return { fn, getCalls: () => calls };
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

Deno.test("deterministische 404 komt direct terug zonder retry", async () => {
  const stub = fetchStub([404]);
  const res = await fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, baseDelayMs: 1 });
  assertEquals(res.status, 404);
  assertEquals(stub.getCalls(), 1);
});

Deno.test("aanhoudende 503 gooit na alle pogingen een duidelijke fout", async () => {
  const stub = fetchStub([503]);
  await assertRejects(
    () => fetchPcsPage("https://pcs/x", { fetchFn: stub.fn, retries: 2, baseDelayMs: 1 }),
    Error,
    "PCS status 503 (na 3 pogingen)",
  );
  assertEquals(stub.getCalls(), 3);
});
