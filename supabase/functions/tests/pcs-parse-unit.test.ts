// Tests voor de nieuwe PCS-uitslaglayout (sinds ~eind sept 2026: ul.unitTopnav +
// div.resultCont + table.unit.results). Fixtures zijn echte, ingekorte PCS-pagina's
// van de Vuelta 2026; de verwachte waarden zijn renner-voor-renner gelijk aan wat
// destijds (oude layout) in stage_results is opgeslagen. Draaien met:
//   deno test --allow-read supabase/functions/tests/
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { isUnitLayout, parseStagePage } from "../_shared/pcs-parse.ts";

function fixture(name: string) {
  const html = Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return new DOMParser().parseFromString(html, "text/html")!;
}

const bySlug = (rs: any[], slug: string) => {
  const r = rs.find(x => x.pcs_slug === slug);
  assert(r, `renner ${slug} niet gevonden`);
  return r;
};

Deno.test("unit-layout: herkenning", () => {
  assert(isUnitLayout(fixture("pcs-unit-vuelta-2026-stage-9.html")));
});

Deno.test("unit-layout bergrit (Vuelta 2026 et. 9): tijden, ,,-groepen, DNF", () => {
  const rs = parseStagePage(fixture("pcs-unit-vuelta-2026-stage-9.html"));
  assertEquals(rs.length, 173);
  const mas = bySlug(rs, "enric-mas");
  assertEquals([mas.finish_position, mas.bib_number, mas.time_seconds], [1, 21, 5 * 3600 + 10 * 60 + 40]);
  // ",," = zelfde tijd als vorige renner
  assertEquals(bySlug(rs, "oscar-onley").time_seconds, mas.time_seconds);
  // "0:12" = achterstand op de winnaar
  assertEquals(bySlug(rs, "primoz-roglic").time_seconds, mas.time_seconds + 12);
  // DNF staat in de rnk-kolom
  const dnf = rs.filter(r => r.dnf).map(r => r.pcs_slug).sort();
  assertEquals(dnf, ["kaden-groves", "pablo-torres-arias", "victor-langellotti"]);
  assertEquals(bySlug(rs, "kaden-groves").finish_position, null);
});

Deno.test("unit-layout: punten en bergpunten van vandaag (kolom pnt_won)", () => {
  const rs = parseStagePage(fixture("pcs-unit-vuelta-2026-stage-9.html"));
  assertEquals([bySlug(rs, "enric-mas").points, bySlug(rs, "enric-mas").mountain_points], [20, 10]);
  // Bergpunten verzameld op meerdere toppen, geen punten aan de finish
  assertEquals([bySlug(rs, "santiago-buitrago-sanchez").points, bySlug(rs, "santiago-buitrago-sanchez").mountain_points], [6, 18]);
  // Punten uit een tussensprint én bergpunten, ver achter binnen
  assertEquals([bySlug(rs, "alessandro-romele").points, bySlug(rs, "alessandro-romele").mountain_points], [20, 9]);
});

Deno.test("unit-layout: bonificaties uit finish + bergtop", () => {
  const rs = parseStagePage(fixture("pcs-unit-vuelta-2026-stage-9.html"));
  assertEquals(bySlug(rs, "enric-mas").bonification_seconds, 10);
  assertEquals(bySlug(rs, "oscar-onley").bonification_seconds, 6);
  assertEquals(bySlug(rs, "primoz-roglic").bonification_seconds, 4);
  // Alleen bonificatie op een bergtop (KOM Sprint)
  assertEquals(bySlug(rs, "alessandro-romele").bonification_seconds, 6);
  assertEquals(bySlug(rs, "pavel-sivakov").bonification_seconds, 4);
  assertEquals(bySlug(rs, "marcel-camprubi").bonification_seconds, 2);
  assertEquals(rs.filter(r => r.bonification_seconds > 0).length, 6);
});

Deno.test("unit-layout tijdrit (Vuelta 2026 et. 1): honderdsten en gaps", () => {
  const rs = parseStagePage(fixture("pcs-unit-vuelta-2026-stage-1.html"));
  assertEquals(rs.length, 184);
  // "10:57,14" → 657 s; "0:00,09" → zelfde seconde; "0:04,19" → +4 s
  assertEquals(bySlug(rs, "tadej-pogacar").time_seconds, 657);
  assertEquals(bySlug(rs, "ethan-hayter").time_seconds, 657);
  assertEquals(bySlug(rs, "joshua-tarling").time_seconds, 661);
  assertEquals(bySlug(rs, "tadej-pogacar").points, 20);
  assertEquals(rs.filter(r => r.bonification_seconds > 0).length, 0);
  assertEquals(rs.filter(r => r.dnf).length, 0);
});

Deno.test("unit-layout: bonificatie telt alleen onder Points/KOM-Today, niet nogmaals via Youth", () => {
  const th = `<tr><th data-code="rnk">Rnk</th><th data-code="bib">BIB</th><th data-code="rider">Rider</th><th data-code="pnt">Pnt</th><th data-code="bonis"></th></tr>`;
  const html = `<html><body>
    <ul class="unitTabs unitTopnav">
      <li><div><a class="resultNav" data-parentid="1" data-navid="1"><center>Stage</center></a></div></li>
      <li><div><a class="resultNav" data-parentid="2" data-navid="20"><center>Points</center></a></div></li>
      <li><div><a class="resultNav" data-parentid="3" data-navid="30"><center>Youth</center></a></div></li>
    </ul>
    <ul class="buttonNav unitSubnav hide" data-parentid="2"><li><div><a class="resultNav" data-navid="20">General</a></div></li><li><div><a class="resultNav" data-navid="21">Today</a></div></li></ul>
    <ul class="buttonNav unitSubnav hide" data-parentid="3"><li><div><a class="resultNav" data-navid="30">General</a></div></li><li><div><a class="resultNav" data-navid="31">Today</a></div></li></ul>
    <div class="resultCont" data-navid="1"><table class="unit results">
      <tr><th data-code="rnk">Rnk</th><th data-code="bib">BIB</th><th data-code="rider">Rider</th><th data-code="timelag">Timelag</th></tr>
      <tr><td>1</td><td>7</td><td><a href="rider/jong-talent">J T</a></td><td>4:00:00</td></tr>
    </table></div>
    <div class="resultCont hide" data-navid="21"><h3>Points at finish</h3><table class="unit results">${th}
      <tr><td>1</td><td>7</td><td><a href="rider/jong-talent">J T</a></td><td>20</td><td>10″</td></tr></table></div>
    <div class="resultCont hide" data-navid="31"><h3>Youth day classification</h3><table class="unit results">${th}
      <tr><td>1</td><td>7</td><td><a href="rider/jong-talent">J T</a></td><td></td><td>10″</td></tr></table></div>
  </body></html>`;
  const rs = parseStagePage(new DOMParser().parseFromString(html, "text/html")!);
  assertEquals(rs[0].bonification_seconds, 10);
  // Geen General-tabel met pnt_won → punten uit de Today-tabellen
  assertEquals(rs[0].points, 20);
});

Deno.test("unit-layout: startlijst (geen tijden) → duidelijke fout", () => {
  const html = `<html><body>
    <ul class="unitTabs unitTopnav"><li><div><a class="resultNav" data-parentid="1" data-navid="1" href="#"><center>Stage</center></a></div></li></ul>
    <div class="resultCont" data-navid="1"><table class="unit results">
      <tr><th data-code="rnk">Rnk</th><th data-code="bib">BIB</th><th data-code="rider">Rider</th><th data-code="timelag">Timelag</th></tr>
      <tr><td></td><td>1</td><td><a href="rider/a-b">A B</a></td><td></td></tr>
    </table></div></body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  assertThrows(() => parseStagePage(doc), Error, "startlijst");
});
