// Tests voor de race-import in de nieuwe PCS-layout (etappemenu + etappe-infoblok).
// Fixtures: ingekorte echte pagina's van de Tour of Guangxi 2026. Draaien met:
//   deno test --allow-read supabase/functions/tests/
import { assertEquals } from "jsr:@std/assert";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { parseStageInfo, parseStageNav } from "../_shared/pcs-race-parse.ts";

function fixture(name: string) {
  const html = Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return new DOMParser().parseFromString(html, "text/html")!;
}

Deno.test("etappemenu: etappes uit de selectNav (GC- en vrouwenkoers genegeerd)", () => {
  const stages = parseStageNav(fixture("pcs-race-nav-guangxi-2026.html"));
  assertEquals(stages.map(s => s.stage_number), [1, 2, 3, 4, 5, 6]);
  assertEquals(stages[1], {
    stage_number: 2,
    name: "Chongzuo - Jingxi",
    departure: "Chongzuo",
    arrival: "Jingxi",
    _href: "race/tour-of-guangxi-2026-stage-2",
  });
  assertEquals(stages[3].arrival, "Tian'e");
});

Deno.test("etappemenu: proloog en ontbrekend menu", () => {
  const doc = new DOMParser().parseFromString(`<html><body><select>
    <option value="race/x-2026-prologue/stages">Prologue | A - A</option>
    <option value="race/x-2026-stage-1/stages">Stage 1 | A - B</option>
    <option value="race/x-2026-gc/stages">General classification</option></select></body></html>`, "text/html")!;
  assertEquals(parseStageNav(doc).map(s => [s.stage_number, s._href]), [[0, "race/x-2026-prologue"], [1, "race/x-2026-stage-1"]]);
  assertEquals(parseStageNav(new DOMParser().parseFromString("<html><body></body></html>", "text/html")!), []);
});

Deno.test("etappe-info: datum, starttijd, afstand, type, vertrek/aankomst", () => {
  assertEquals(parseStageInfo(fixture("pcs-stage-info-guangxi-2026-stage-1.html")), {
    date: "2026-10-13",
    startTime: "10:30",
    distance_km: 149.4,
    parcoursIcon: "icon profile p2 mg_rp4",
    departure: "Chongzuo",
    arrival: "Chongzuo",
    vertical_meters: 768,
    profile_score: 22,
  });
});

Deno.test("etappe-info: lege pagina geeft nulls (geen crash)", () => {
  const info = parseStageInfo(new DOMParser().parseFromString("<html><body></body></html>", "text/html")!);
  assertEquals([info.date, info.startTime, info.distance_km, info.parcoursIcon], [null, null, null, ""]);
});
