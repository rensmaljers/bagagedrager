// Tests voor de PCS-parselogica. Draaien met:
//   deno test --allow-read supabase/functions/tests/
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import { parseStagePage, parseTime } from "../_shared/pcs-parse.ts";

function parseDoc(html: string) {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html")!;
}

Deno.test("parseTime: alle PCS-tijdformaten", () => {
  assertEquals(parseTime("3:53:11"), 3 * 3600 + 53 * 60 + 11);
  assertEquals(parseTime("53:11"), 53 * 60 + 11);
  assertEquals(parseTime("11"), 11);
  assertEquals(parseTime("0:19"), 19);
  // Proloog/TT met honderdsten
  assertEquals(parseTime("3:35,12"), 3 * 60 + 35);
  assertEquals(parseTime("0:06.12"), 6);
  // TTT met milliseconden (3 cijfers)
  assertEquals(parseTime("32:52.170"), 32 * 60 + 52);
  // ITT/proloog: punt scheidt min/sec, komma = honderdsten ("26.37,99" = 26min37s)
  assertEquals(parseTime("26.37,99"), 26 * 60 + 37);
  assertEquals(parseTime("0.06,68"), 6);
  assertEquals(parseTime("0.00,04"), 0);
  // Leeg / zelfde-tijd-markers
  assertEquals(parseTime(""), 0);
  assertEquals(parseTime(",,"), 0);
  assertEquals(parseTime("-"), 0);
});

// ---- Normale etappe (results-tabel in STAGE-tab) ----

const NORMAL_STAGE = `
<ul class="restabs">
  <li><a data-id="1">STAGE</a></li>
  <li><a data-id="2">GC</a></li>
  <li><a data-id="3">POINTS</a></li>
  <li><a data-id="4">KOM</a></li>
</ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/winner-man">Winner Man</a></td><td class="ar cu600">10″</td><td class="time ar"><font>3:43:33</font></td></tr>
  <tr><td class="bibs">2</td><td>x</td><td><a href="rider/second-guy">Second Guy</a></td><td class="ar cu600"></td><td class="time ar">,,</td></tr>
  <tr><td class="bibs">3</td><td>x</td><td><a href="rider/third-dude">Third Dude</a></td><td class="ar cu600">2″-4″</td><td class="time ar">0:19</td></tr>
  <tr><td class="bibs">4</td><td>x</td><td><a href="rider/crash-rider">Crash Rider</a></td><td class="ar cu600"></td><td class="time ar">*0:00</td></tr>
  <tr><td class="bibs">5</td><td>DNF</td><td><a href="rider/dnf-rider">Dnf Rider</a></td><td class="ar cu600"></td><td class="time ar">-</td></tr>
</tbody></table></div>
<div class="resTab" data-id="2"><table class="results"><tbody>
  <tr><td class="bibs">3</td><td>x</td><td><a href="rider/third-dude">Third Dude</a></td><td class="time ar">10:01:01</td></tr>
</tbody></table></div>
<div class="resTab" data-id="3"><table class="results"><tbody>
  <tr><td class="bibs">3</td><td>x</td><td><a href="rider/third-dude">Third Dude</a></td><td class="pnt">25</td></tr>
</tbody></table></div>
<div class="resTab" data-id="4"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/winner-man">Winner Man</a></td><td class="pnt">5</td></tr>
</tbody></table></div>
`;

Deno.test("normale etappe: tijden, zelfde-tijd-groep, valpartijregel, DNF, bonus, punten", () => {
  const results = parseStagePage(parseDoc(NORMAL_STAGE));
  assertEquals(results.length, 5);

  const winnerTime = 3 * 3600 + 43 * 60 + 33;
  const [winner, second, third, crash, dnf] = results;

  assertEquals(winner.pcs_slug, "winner-man");
  assertEquals(winner.time_seconds, winnerTime);
  assertEquals(winner.finish_position, 1);
  assertEquals(winner.bonification_seconds, 10);
  assertEquals(winner.mountain_points, 5);

  // ",," = zelfde tijd als vorige renner
  assertEquals(second.time_seconds, winnerTime);
  assertEquals(second.finish_position, 2);

  assertEquals(third.time_seconds, winnerTime + 19);
  assertEquals(third.points, 25);
  // "2″-4″" = bonificaties optellen
  assertEquals(third.bonification_seconds, 6);

  // "*0:00" = valpartij laatste 3km → winnaarstijd
  assertEquals(crash.time_seconds, winnerTime);

  assertEquals(dnf.dnf, true);
  assertEquals(dnf.finish_position, null);
});

Deno.test("normale etappe: pakt STAGE-tab, niet de GC-tabel", () => {
  const results = parseStagePage(parseDoc(NORMAL_STAGE));
  // GC-tabel heeft derde renner op 10:01:01 — die mag de uitslag niet vervuilen
  const third = results.find(r => r.pcs_slug === "third-dude")!;
  assertEquals(third.time_seconds, 3 * 3600 + 43 * 60 + 33 + 19);
});

// ---- Bergrit met meerdere klimmen (KOM-tab heeft General + Today-split) ----
// PCS toont op de KOM-tab bij meerdere beklimmingen een cumulatief "General"-klassement
// (td zonder class) plus een verborgen div.today met per klim een eigen tabelletje
// (td.pnt). We moeten de Today-tabelletjes sommeren, niet het General-cijfer pakken
// (regressie: etappe 6 Tour 2026, zie migratie-notitie).
const MULTI_CLIMB_STAGE = `
<ul class="restabs">
  <li><a data-id="1">STAGE</a></li>
  <li><a data-id="4">KOM</a></li>
</ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/climber-a">Climber A</a></td><td class="time ar"><font>3:43:33</font></td></tr>
  <tr><td class="bibs">2</td><td>x</td><td><a href="rider/climber-b">Climber B</a></td><td class="time ar">,,</td></tr>
</tbody></table></div>
<div class="resTab" data-id="4">
  <ul class="buttonNav"><li><a class="viewGeneral" href="">General</a></li><li><a class="viewToday" href="">Today</a></li></ul>
  <table class="results"><tbody>
    <tr><td class="bibs">1</td><td><a href="rider/climber-a">Climber A</a></td><td>28</td></tr>
    <tr><td class="bibs">2</td><td><a href="rider/climber-b">Climber B</a></td><td>19</td></tr>
  </tbody></table>
  <div class="today hide">
    <h4>KOM Sprint (1) Col Eerste</h4>
    <table class="results"><tbody>
      <tr><td class="bibs">2</td><td><a href="rider/climber-b">Climber B</a></td><td class="pnt">10</td></tr>
      <tr><td class="bibs">1</td><td><a href="rider/climber-a">Climber A</a></td><td class="pnt">6</td></tr>
    </tbody></table>
    <h4>KOM Sprint (HC) Slotklim</h4>
    <table class="results"><tbody>
      <tr><td class="bibs">1</td><td><a href="rider/climber-a">Climber A</a></td><td class="pnt">20</td></tr>
      <tr><td class="bibs">2</td><td><a href="rider/climber-b">Climber B</a></td><td class="pnt">15</td></tr>
    </tbody></table>
  </div>
</div>
`;

Deno.test("KOM-tab met General+Today-split: sommeert Today-tabelletjes, negeert General-cumulatief", () => {
  const results = parseStagePage(parseDoc(MULTI_CLIMB_STAGE));
  const a = results.find(r => r.pcs_slug === "climber-a")!;
  const b = results.find(r => r.pcs_slug === "climber-b")!;
  // Today: A scoorde 6+20=26, B scoorde 10+15=25 — niet de General-waarden (28/19)
  assertEquals(a.mountain_points, 26);
  assertEquals(b.mountain_points, 25);
});

// ---- Vrouwenkoers: bergklassement heet QOM, niet KOM ----
// Tabs op bijv. Tour de France Femmes 2026: STAGE | GC | POINTS | QOM | YOUTH | TEAMS
// (regressie: TdF Femmes 2026 etappe 1-2 kregen 0 bergpunten omdat alleen "KOM" gematcht werd).
const QOM_STAGE = `
<ul class="restabs">
  <li><a data-id="1">STAGE</a></li>
  <li><a data-id="2">GC</a></li>
  <li><a data-id="3">POINTS</a></li>
  <li><a data-id="4">QOM</a></li>
  <li><a data-id="5">YOUTH</a></li>
</ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/climber-w">Climber W</a></td><td class="time ar"><font>3:43:33</font></td></tr>
  <tr><td class="bibs">2</td><td>x</td><td><a href="rider/sprinter-w">Sprinter W</a></td><td class="time ar">,,</td></tr>
</tbody></table></div>
<div class="resTab" data-id="4"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/climber-w">Climber W</a></td><td class="pnt">12</td></tr>
</tbody></table></div>
`;

Deno.test("QOM-tab (vrouwenkoers) wordt als bergklassement gelezen", () => {
  const results = parseStagePage(parseDoc(QOM_STAGE));
  const w = results.find(r => r.pcs_slug === "climber-w")!;
  assertEquals(w.mountain_points, 12);
});

// PCS toont in de Today-tabel voor een tussensprint/top met bonusseconden een extra
// td.delta_pnt-kolom naast td.pnt. "delta_pnt" bevat de substring "pnt", dus een naïeve
// cls.includes("pnt")-check matcht ook die kolom en overschrijft de echte puntenwaarde
// met de (vaak lege) bonusseconden-waarde (regressie: etappe 6 Tour 2026, Lipowitz kreeg
// 0 punten i.p.v. 10 omdat zijn delta_pnt-cel leeg was).
const DELTA_PNT_COLLISION_STAGE = `
<ul class="restabs">
  <li><a data-id="1">STAGE</a></li>
  <li><a data-id="4">POINTS</a></li>
</ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/climber-a">Climber A</a></td><td class="time ar"><font>3:43:33</font></td></tr>
  <tr><td class="bibs">2</td><td>x</td><td><a href="rider/climber-b">Climber B</a></td><td class="time ar">,,</td></tr>
</tbody></table></div>
<div class="resTab" data-id="4">
  <ul class="buttonNav"><li><a class="viewGeneral" href="">General</a></li><li><a class="viewToday" href="">Today</a></li></ul>
  <table class="results"><tbody>
    <tr><td class="bibs">1</td><td><a href="rider/climber-a">Climber A</a></td><td>75</td></tr>
    <tr><td class="bibs">2</td><td><a href="rider/climber-b">Climber B</a></td><td>54</td></tr>
  </tbody></table>
  <div class="today hide">
    <table class="results"><tbody>
      <tr><td class="bibs">1</td><td><a href="rider/climber-a">Climber A</a></td><td class="pnt">20</td><td></td><td class="delta_pnt ar green">10</td></tr>
      <tr><td class="bibs">2</td><td><a href="rider/climber-b">Climber B</a></td><td class="pnt">15</td><td></td><td class="delta_pnt ar green"></td></tr>
    </tbody></table>
  </div>
</div>
`;

Deno.test("POINTS-tab: td.pnt niet verward met td.delta_pnt (bonusseconden-kolom)", () => {
  const results = parseStagePage(parseDoc(DELTA_PNT_COLLISION_STAGE));
  const a = results.find(r => r.pcs_slug === "climber-a")!;
  const b = results.find(r => r.pcs_slug === "climber-b")!;
  assertEquals(a.points, 20);
  // B heeft een lege delta_pnt-cel (geen bonusseconden) — mag zijn punten (15) niet naar 0 trekken
  assertEquals(b.points, 15);
});

// PCS vult verborgen kolommen (hide_td) in de STAGE-tabel soms met andermans data —
// renner A kan daar de bib van renner B hebben. Een per-rij slug-OF-bib-match geeft
// de klassementpunten dan aan de verkeerde renner (etappe 8 Tour 2026: Russo's 22
// finishpunten gingen naar Kanter omdat Kanter in de STAGE-tabel Russo's bib had).
const WRONG_HIDDEN_BIB_STAGE = `
<ul class="restabs">
  <li><a data-id="1">STAGE</a></li>
  <li><a data-id="4">POINTS</a></li>
</ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">188</td><td>x</td><td><a href="rider/rider-a">A</a></td><td class="time ar"><font>3:43:33</font></td></tr>
  <tr><td class="bibs">64</td><td>x</td><td><a href="rider/rider-b">B</a></td><td class="time ar">,,</td></tr>
</tbody></table></div>
<div class="resTab" data-id="4"><table class="results"><tbody>
  <tr><td class="bibs">188</td><td><a href="rider/rider-b">B</a></td><td class="pnt">22</td></tr>
  <tr><td class="bibs">64</td><td><a href="rider/rider-a">A</a></td><td class="pnt">12</td></tr>
</tbody></table></div>
`;

Deno.test("POINTS-tab: slug wint van bib-coincidentie (verborgen kolommen bevatten soms andermans bib)", () => {
  const results = parseStagePage(parseDoc(WRONG_HIDDEN_BIB_STAGE));
  const a = results.find(r => r.pcs_slug === "rider-a")!;
  const b = results.find(r => r.pcs_slug === "rider-b")!;
  assertEquals(a.points, 12);
  assertEquals(b.points, 22);
});

// ---- Ploegentijdrit (ul.ttt-results, geen table.results in STAGE-tab) ----

const TTT_STAGE = `
<ul class="restabs">
  <li><a data-id="10">STAGE</a></li>
  <li><a data-id="20">GC</a></li>
</ul>
<div class="resTab" data-id="10"><div class="general"><ul class="list ttt-results">
  <li class="fs10 clr999 uppercase hideIfMobile"><div>#</div><div>Team</div><div>Time</div></li>
  <li>
    <div><div>1</div><div><a href="team/team-a-2026">Team A</a></div></div>
    <div class="timeSpeed"><div class="time">32:52.170</div><div>0:00</div></div>
    <div><table><tbody>
      <tr><td><a href="rider/rider-one">One</a></td><td>20</td></tr>
      <tr><td><a href="rider/rider-two">Two</a> <font class="blue">+0:14</font></td><td>20</td></tr>
      <tr><td><a href="rider/rider-late">Late</a> <font class="blue">+9:59</font></td><td>20</td></tr>
    </tbody></table></div>
  </li>
  <li>
    <div><div>2</div><div><a href="team/team-b-2026">Team B</a></div></div>
    <div class="timeSpeed"><div class="time">33:01.780</div><div>0:09</div></div>
    <div><table><tbody>
      <tr><td><a href="rider/rider-three">Three</a></td><td>16</td></tr>
    </tbody></table></div>
  </li>
</ul></div></div>
<div class="resTab" data-id="20"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/rider-one">One</a></td><td class="time ar">10:01:01</td></tr>
</tbody></table></div>
`;

Deno.test("TTT: rennertijd = teamtijd + individuele achterstand, gesorteerd op tijd", () => {
  const results = parseStagePage(parseDoc(TTT_STAGE));
  assertEquals(results.length, 4);

  const teamA = 32 * 60 + 52;
  const teamB = 33 * 60 + 1;

  // Gesorteerd op individuele tijd: One (32:52), Three (33:01), Two (33:06), Late (42:51)
  assertEquals(results.map(r => r.pcs_slug), ["rider-one", "rider-three", "rider-two", "rider-late"]);
  assertEquals(results[0].time_seconds, teamA);
  assertEquals(results[1].time_seconds, teamB);
  assertEquals(results[2].time_seconds, teamA + 14);
  // Gelost van team 1 is trager dan heel team 2
  assertEquals(results[3].time_seconds, teamA + 9 * 60 + 59);
  assertEquals(results.map(r => r.finish_position), [1, 2, 3, 4]);
});

Deno.test("TTT: pakt niet de GC-tabel als fallback", () => {
  const results = parseStagePage(parseDoc(TTT_STAGE));
  // GC-tabel toont One op 10:01:01 — TTT-uitslag moet de teamtijd geven
  assertEquals(results[0].time_seconds, 32 * 60 + 52);
});

// ---- Individuele tijdrit (ITT/proloog) ----
// PCS-cel: tekstnode = tijd ("26.37"), <font> = honderdsten (",99"), hide-span leeg.
// Winnaar toont absolute tijd; rest toont achterstand (eveneens in M.SS,hh).
const ITT_STAGE = `
<ul class="restabs">
  <li><a data-id="1">STAGE</a></li>
  <li><a data-id="2">GC</a></li>
</ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/itt-winner">Winner</a></td><td class="ar cu600"></td><td class="time ar">26.37<font class="fs10">,99</font><span class="hide"></span></td></tr>
  <tr><td class="bibs">2</td><td>x</td><td><a href="rider/itt-second">Second</a></td><td class="ar cu600"></td><td class="time ar">0.06<font class="fs10">,68</font><span class="hide"></span></td></tr>
  <tr><td class="bibs">3</td><td>x</td><td><a href="rider/itt-third">Third</a></td><td class="ar cu600"></td><td class="time ar">0.10<font class="fs10">,79</font><span class="hide"></span></td></tr>
</tbody></table></div>
<div class="resTab" data-id="2"><table class="results"><tbody>
  <tr><td class="bibs">3</td><td>x</td><td><a href="rider/itt-third">Third</a></td><td class="time ar">10:01:01</td></tr>
</tbody></table></div>
`;

Deno.test("ITT: M.SS,hh-tijdformaat met font-honderdsten en lege hide-span", () => {
  const results = parseStagePage(parseDoc(ITT_STAGE));
  assertEquals(results.length, 3);
  const winnerTime = 26 * 60 + 37;
  assertEquals(results[0].time_seconds, winnerTime);
  assertEquals(results[0].finish_position, 1);
  assertEquals(results[1].time_seconds, winnerTime + 6);   // +0.06,68
  assertEquals(results[2].time_seconds, winnerTime + 10);  // +0.10,79
});

// Wegrit-cel dupliceert de zichtbare tijd in de hide-span — duplicaat moet eraf.
const ROAD_HIDE_STAGE = `
<ul class="restabs"><li><a data-id="1">STAGE</a></li></ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/road-winner">Winner</a></td><td class="ar cu600"></td><td class="time ar"><font>3:34:46</font><span class="hide">3:34:46</span></td></tr>
  <tr><td class="bibs">2</td><td>x</td><td><a href="rider/road-second">Second</a></td><td class="ar cu600"></td><td class="time ar"><font>2:14</font><span class="hide">2:14</span></td></tr>
</tbody></table></div>
`;

Deno.test("wegrit: hide-span-duplicaat verdubbelt de tijd niet", () => {
  const results = parseStagePage(parseDoc(ROAD_HIDE_STAGE));
  const winnerTime = 3 * 3600 + 34 * 60 + 46;
  assertEquals(results[0].time_seconds, winnerTime);
  assertEquals(results[1].time_seconds, winnerTime + 2 * 60 + 14);
});

// ---- Foutscenario's ----

Deno.test("startlijst (geen tijden) geeft duidelijke fout", () => {
  const html = `
<ul class="restabs"><li><a data-id="1">STAGE</a></li></ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/winner-man">Winner</a></td><td>Team X</td></tr>
</tbody></table></div>`;
  assertThrows(() => parseStagePage(parseDoc(html)), Error, "startlijst");
});

Deno.test("pagina zonder uitslag geeft fout (geen stille GC-fallback)", () => {
  const html = `
<ul class="restabs"><li><a data-id="1">STAGE</a></li><li><a data-id="2">GC</a></li></ul>
<div class="resTab" data-id="1"><p>Nog geen uitslag</p></div>
<div class="resTab" data-id="2"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/gc-leader">Leader</a></td><td class="time ar">10:01:01</td></tr>
</tbody></table></div>`;
  assertThrows(() => parseStagePage(parseDoc(html)), Error, "Geen resultaten-tabel");
});

Deno.test("pagina zonder tabs: eerste table.results gebruiken", () => {
  const html = `
<table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td><a href="rider/solo-winner">Solo</a></td><td class="time ar">4:01:02</td></tr>
</tbody></table>`;
  const results = parseStagePage(parseDoc(html));
  assertEquals(results.length, 1);
  assertEquals(results[0].time_seconds, 4 * 3600 + 62);
});

// PCS serveert (bevestigd rechtstreeks op procyclingstats.com, dus geen eigenaardigheid
// van de renderproxy) soms een pagina waarbij twee vlak na elkaar finishende renners
// elkaars teamnaam (en dus mogelijk tijd) hebben — precies wat er gebeurde met
// Carapaz/Skjelmose in etappe 4 Vuelta 2026. Dit bleek na verloop van tijd bij bijna
// elke etappe voor te komen (PCS-eigen CDN-inconsistentie), dus blokkeren we de sync
// niet meer — we markeren de rij zodat de admin 'm kan natrekken.
const TEAM_MISMATCH_STAGE = `
<ul class="restabs"><li><a data-id="1">STAGE</a></li></ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">8</td><td>x</td><td class="ridername"><div class="cont"><a href="rider/skjelmose">Skjelmose Mattias</a><div class="showIfMobile fs12 clr999">Lidl - Trek</div></div></td><td class="cu600"><a href="team/ef-education-easypost-2026">EF Education - EasyPost</a></td><td class="time ar"><font>2:57</font></td></tr>
  <tr><td class="bibs">9</td><td>x</td><td class="ridername"><div class="cont"><a href="rider/carapaz">Carapaz Richard</a><div class="showIfMobile fs12 clr999">EF Education - EasyPost</div></div></td><td class="cu600"><a href="team/lidl-trek-2026">Lidl - Trek</a></td><td class="time ar"><font>3:17</font></td></tr>
</tbody></table></div>`;

Deno.test("STAGE-tab: team-mismatch tussen mobiel en desktop veld blokkeert de sync niet, maar markeert de rij", () => {
  const results = parseStagePage(parseDoc(TEAM_MISMATCH_STAGE));
  assertEquals(results.length, 2);
  const skjelmose = results.find(r => r.pcs_slug === "skjelmose")!;
  const carapaz = results.find(r => r.pcs_slug === "carapaz")!;
  assertEquals(skjelmose.suspect_team_mismatch, true);
  assertEquals(carapaz.suspect_team_mismatch, true);
  // Tijden worden gewoon opgeslagen (niet geblokkeerd), ondanks de markering
  assertEquals(skjelmose.time_seconds > 0, true);
  assertEquals(carapaz.time_seconds > 0, true);
});

Deno.test("STAGE-tab: consistente team-velden geven geen markering", () => {
  const html = `
<ul class="restabs"><li><a data-id="1">STAGE</a></li></ul>
<div class="resTab" data-id="1"><table class="results"><tbody>
  <tr><td class="bibs">1</td><td>x</td><td class="ridername"><div class="cont"><a href="rider/consistent-guy">Consistent Guy</a><div class="showIfMobile fs12 clr999">Team One</div></div></td><td class="cu600"><a href="team/team-one-2026">Team One</a></td><td class="time ar"><font>3:43:33</font></td></tr>
</tbody></table></div>`;
  const results = parseStagePage(parseDoc(html));
  assertEquals(results.length, 1);
  assertEquals(results[0].pcs_slug, "consistent-guy");
  assertEquals(results[0].suspect_team_mismatch, false);
});
