import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { parseDropoutsPage } from "../_shared/pcs-dropouts.ts";

// Structuur 1-op-1 van procyclingstats.com/race/tour-de-france/2025/results/dropouts
// (vastgelegd 4 juli 2026): table.basic met # | Stage | Rider | Type | Reason | Injury.
// De pagina bevat ook andere tabellen — de parser moet op de koppen selecteren.
const HTML = `
<html><body>
<table class="basic">
  <thead><tr><th>#</th><th>Pos</th><th>Rider</th><th>Time</th></tr></thead>
  <tbody><tr><td>1</td><td>1</td><td><a href="rider/tadej-pogacar">POGAČAR Tadej</a></td><td>76:00:32</td></tr></tbody>
</table>
<table class="basic">
  <thead><tr><th>#</th><th></th><th>Rider</th><th>Type</th><th>Reason</th><th>Injury</th></tr></thead>
  <tbody>
    <tr><td>1</td><td><a href="race/tour-de-france/2025/stage-1">Stage 1</a></td><td><a href="rider/filippo-ganna">GANNA Filippo</a></td><td>DNF</td><td></td><td></td></tr>
    <tr><td>2</td><td><a href="race/tour-de-france/2025/stage-5">Stage 5 (ITT)</a></td><td><a href="rider/jasper-de-buyst">DE BUYST Jasper</a></td><td>DNS</td><td></td><td></td></tr>
    <tr><td>3</td><td><a href="race/tour-de-france/2025/prologue">Prologue</a></td><td><a href="rider/some-rider">RIDER Some</a></td><td>OTL</td><td>Time limit</td><td></td></tr>
    <tr><td>4</td><td></td><td><a href="rider/no-stage-guy">GUY No-stage</a></td><td>DSQ</td><td></td><td></td></tr>
  </tbody>
</table>
</body></html>`;

Deno.test("dropouts: juiste tabel gekozen, slug/type/etappe geparset", () => {
  const doc = new DOMParser().parseFromString(HTML, "text/html")!;
  const d = parseDropoutsPage(doc);
  assertEquals(d.length, 4);
  assertEquals(d[0], { pcs_slug: "filippo-ganna", name: "GANNA Filippo", type: "DNF", stage_number: 1 });
  assertEquals(d[1].type, "DNS");
  assertEquals(d[1].stage_number, 5);
  assertEquals(d[2].stage_number, 0); // proloog
  assertEquals(d[3].stage_number, null); // geen etappe-link
});

Deno.test("dropouts: lege pagina zonder dropouts-tabel geeft lege lijst", () => {
  const doc = new DOMParser().parseFromString("<html><body><table class='basic'><thead><tr><th>Pos</th><th>Rider</th></tr></thead></table></body></html>", "text/html")!;
  assertEquals(parseDropoutsPage(doc), []);
});
