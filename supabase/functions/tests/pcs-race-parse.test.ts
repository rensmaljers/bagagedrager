// Tests voor de race-import in de nieuwe PCS-layout (etappemenu + etappe-infoblok).
// Fixtures: ingekorte echte pagina's van de Tour of Guangxi 2026. Draaien met:
//   deno test --allow-read supabase/functions/tests/
import { assertEquals } from "jsr:@std/assert";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { findProfileImage, mapStageType, parseRaceInfoHtml, parseStageInfo, parseStageNav, pcsRaceBase } from "../_shared/pcs-race-parse.ts";

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

Deno.test("etappetype: alleen het losse p1..p5-token telt (niet mg_rp4)", () => {
  assertEquals(mapStageType("icon profile p2 mg_rp4", "Chongzuo - Chongzuo"), "sprint");
  assertEquals(mapStageType("icon profile p1 mg_rp4", "A - B"), "flat");
  assertEquals(mapStageType("icon profile p3 mg_rp4", "A - B"), "hills");
  assertEquals(mapStageType("icon profile p5 mg_rp4", "A - B"), "mountain");
  // Oude layout (zonder marge-class)
  assertEquals(mapStageType("icon profile p4", "A - B"), "mountain");
  assertEquals(mapStageType("", "Stage 1 (ITT) | Monaco - Monaco"), "tt");
  assertEquals(mapStageType("icon profile p1", "Stage 3 (TTT) | A - B"), "ttt");
});

Deno.test("pcsRaceBase: alles na het jaar eraf (één definitie voor import en uitvallers-check)", () => {
  const b = "https://www.procyclingstats.com/race/tour-de-france/2026";
  for (const u of [b, b + "/", b + "/stages", b + "/startlist", b + "/stage-12", b + "/prologue", b + "/dropouts", b + "/gc", b + "/result", b + "/overview"]) {
    assertEquals(pcsRaceBase(u), b, u);
  }
  assertEquals(pcsRaceBase("https://www.procyclingstats.com/race/tour-de-pologne/2026//"), "https://www.procyclingstats.com/race/tour-de-pologne/2026");
});

Deno.test("findProfileImage: eerste profiel-afbeelding, absoluut gemaakt", () => {
  const doc = new DOMParser().parseFromString(`<html><body><img src="images/shirts/x.png">
    <img src="images/profiles/ab/cd/stage-1-profile.jpg"><img src="images/profiles/zz.jpg"></body></html>`, "text/html")!;
  assertEquals(findProfileImage(doc), "https://www.procyclingstats.com/images/profiles/ab/cd/stage-1-profile.jpg");
  assertEquals(findProfileImage(new DOMParser().parseFromString("<html><body></body></html>", "text/html")!), null);
});

Deno.test("parseRaceInfoHtml: nieuwe layout — vertrek/aankomst in een link, 'Profile score'", () => {
  const html = Deno.readTextFileSync(new URL("./fixtures/pcs-stage-info-guangxi-2026-stage-1.html", import.meta.url));
  const info = parseRaceInfoHtml(html);
  assertEquals([info.date, info.startTime, info.distance], ["13 October 2026", "10:30:00", "149.4"]);
  // Met de oude regex waren deze drie null (waarde staat in <a href="location/…">)
  assertEquals([info.departure, info.arrival, info.profileScore], ["Chongzuo", "Chongzuo", "22"]);
  assertEquals([info.verticalMeters, info.classification], ["768", "2.UWT"]);
});

Deno.test("parseRaceInfoHtml: oude layout blijft werken", () => {
  const html = `<div>Date:</div><div>29 March 2026</div><div>Start time:</div><div>11:15</div>
    <div>Departure:</div><div>Gent</div><div>ProfileScore:</div><div>31</div>`;
  const info = parseRaceInfoHtml(html);
  assertEquals([info.date, info.startTime, info.departure, info.profileScore], ["29 March 2026", "11:15", "Gent", "31"]);
});
