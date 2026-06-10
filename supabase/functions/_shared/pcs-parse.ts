// Gedeelde PCS-parselogica voor sync-pcs-results.
// Werkt op een deno_dom Document; getest in supabase/functions/tests/.

export interface StageResult {
  bib_number: number;
  pcs_slug: string | null;
  pcs_name: string | null;
  time_seconds: number;
  finish_position: number | null;
  points: number;
  mountain_points: number;
  bonification_seconds: number;
  dnf: boolean;
}

export function parseTime(timeStr: string): number {
  // PCS time formats: "3:53:11", "53:11", "11"
  // Proloog/TT: "3:35,12" of "0:06.12" — honderdsten strippen voor parsing
  // TTT: "32:52.170" — milliseconden (3 cijfers) ook strippen
  const noHundredths = timeStr.replace(/[,\.]\d{1,3}$/, "");
  const clean = noHundredths.replace(/[^0-9:]/g, "").trim();
  if (!clean) return 0;
  const parts = clean.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

// PCS gebruikt tabs (STAGE, GC, POINTS, KOM, BONIS) — zoek via tab-nav
export function findTabDiv(doc: any, tabKeyword: string) {
  const tabLinks = doc.querySelectorAll("ul.restabs li a, ul.resultTabs li a");
  for (const link of tabLinks) {
    const text = (link.textContent || "").toUpperCase();
    if (text.includes(tabKeyword)) {
      const dataId = link.getAttribute("data-id");
      if (dataId) return doc.querySelector(`div.resTab[data-id="${dataId}"]`);
    }
  }
  return null;
}

export function findTabTable(doc: any, tabKeyword: string) {
  return findTabDiv(doc, tabKeyword)?.querySelector("table.results") || null;
}

// Ploegentijdrit (TTT): STAGE-tab heeft geen table.results maar ul.list.ttt-results
// met per team een blok (teamtijd in div.time, "32:52.170") en daarin een geneste
// tabel met renners; individuele achterstand staat in <font class="blue">+0:14</font>
export function parseTttResults(tttList: any): { results: StageResult[]; winnerTime: number } {
  let winnerTime = 0;
  const tttRiders: { pcs_slug: string; pcs_name: string; time: number; dnf: boolean }[] = [];
  for (const li of tttList.querySelectorAll("li")) {
    const teamLink = li.querySelector("a[href*='team/']");
    const timeEl = li.querySelector("div.time");
    if (!teamLink || !timeEl) continue; // header-regel overslaan
    const teamTime = parseTime(timeEl.textContent || "");
    if (teamTime <= 0) continue;
    if (winnerTime === 0) winnerTime = teamTime;
    for (const tr of li.querySelectorAll("tr")) {
      const riderLink = tr.querySelector("a[href*='rider/']");
      if (!riderLink) continue;
      const href = riderLink.getAttribute("href") || "";
      const pcs_slug = href.replace(/^.*rider\//, "").trim();
      if (!pcs_slug) continue;
      const dnf = /\b(dnf|dns|otl|dsq)\b/i.test(tr.textContent || "");
      const blue = tr.querySelector("font.blue");
      const gap = blue ? parseTime(blue.textContent || "") : 0;
      tttRiders.push({
        pcs_slug,
        pcs_name: riderLink.textContent?.trim() || pcs_slug,
        time: teamTime + gap,
        dnf,
      });
    }
  }
  // Volgorde op individuele tijd (gelost van team 1 kan trager zijn dan team 2)
  tttRiders.sort((a, b) => a.time - b.time);
  const results: StageResult[] = [];
  let position = 0;
  for (const r of tttRiders) {
    if (!r.dnf) position++;
    results.push({
      bib_number: 0,
      pcs_slug: r.pcs_slug,
      pcs_name: r.pcs_name,
      time_seconds: r.time,
      finish_position: r.dnf ? null : position,
      points: 0,
      mountain_points: 0,
      bonification_seconds: 0,
      dnf: r.dnf,
    });
  }
  return { results, winnerTime };
}

// Normale etappe: rijen uit de results-tabel van de STAGE-tab
export function parseTableResults(table: any): { results: StageResult[]; winnerTime: number } {
  const rows = table.querySelectorAll("tbody tr");
  const results: StageResult[] = [];
  let winnerTime = 0; // Absolute time of the stage winner (first row)
  let lastTime = 0;   // Last assigned absolute time (for ,, same-time groups)
  let position = 0;   // PCS finish position (row order = official result order)

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 4) continue;

    let bib = 0, time = 0, dnf = false;
    let pcs_slug: string | null = null;
    let pcs_name: string | null = null;

    // Extract pcs_slug and rider name from rider link (href="rider/tadej-pogacar")
    const riderLink = row.querySelector("a[href*='rider/']");
    if (riderLink) {
      const href = riderLink.getAttribute("href") || "";
      pcs_slug = href.replace(/^.*rider\//, "").trim() || null;
      pcs_name = riderLink.textContent?.trim() || null;
    }

    for (const cell of cells) {
      const cls = cell.className || "";
      const text = cell.textContent?.trim() || "";

      // PCS toont DNS/DNF/OTL soms in de positiekolom i.p.v. de tijdkolom
      if (/\b(dnf|dns|otl|dsq)\b/i.test(text)) {
        dnf = true;
      }

      if (cls.includes("bibs")) {
        bib = parseInt(text) || 0;
      } else if (cls.includes("time") && cls.includes("ar")) {
        // Time cell contains <font>H:MM:SS</font>
        const fontEl = cell.querySelector("font");
        const timeText = fontEl?.textContent?.trim() || text;
        if (/\b(dnf|dns|otl|dsq)\b/i.test(timeText)) {
          dnf = true;
        } else {
          // PCS time formats:
          // - Winner (row 1): absolute time "3:43:33"
          // - Same time group: ",," or empty → zelfde tijd als vorige renner
          // - "*0:00" / "*,," → valpartij laatste 3km, altijd winnaarstijd
          // - Time gap: "0:19" = +19s achter winnaar
          const hasAsterisk = timeText.includes("*");
          const parsed = parseTime(timeText);
          if (parsed > 0) {
            if (winnerTime === 0) {
              winnerTime = parsed;
              time = parsed;
            } else {
              time = winnerTime + parsed;
            }
            lastTime = time;
          } else if (hasAsterisk && winnerTime > 0) {
            // Laatste 3km regel: renner krijgt altijd winnaarstijd
            time = winnerTime;
            lastTime = time;
          } else {
            // Lege cel / ",," = zelfde tijd als vorige renner
            time = lastTime;
          }
        }
      }
    }

    // Bonificatie staat in td.ar.cu600 — tekst gebruikt ″ (double prime) voor seconden
    // Bv: "10″" = 10s, "2″-20″" = 2s + 20s, "" = 0s
    let bonus = 0;
    for (const cell of cells) {
      const cls = cell.className || "";
      if (cls.includes("ar") && cls.includes("cu600")) {
        const txt = cell.textContent || "";
        const matches = [...txt.matchAll(/(\d+)″/g)];
        bonus = matches.reduce((sum, m) => sum + parseInt(m[1]), 0);
      }
    }

    if (bib > 0 || pcs_slug) {
      position++;
      results.push({
        bib_number: bib,
        pcs_slug,
        pcs_name,
        time_seconds: time || lastTime,
        finish_position: dnf ? null : position,
        points: 0,
        mountain_points: 0,
        bonification_seconds: bonus,
        dnf,
      });
    }
  }

  return { results, winnerTime };
}

export function extractClassificationPoints(classTable: any, results: StageResult[], field: "points" | "mountain_points") {
  if (!classTable) return;
  const classRows = classTable.querySelectorAll("tbody tr");
  for (const row of classRows) {
    const cells = row.querySelectorAll("td");
    let classBib = 0, classPts = 0, classSlug: string | null = null;
    // Extract pcs_slug from rider link
    const riderLink = row.querySelector("a[href*='rider/']");
    if (riderLink) {
      const href = riderLink.getAttribute("href") || "";
      classSlug = href.replace(/^.*rider\//, "").trim() || null;
    }
    for (const cell of cells) {
      const cls = cell.className || "";
      const text = cell.textContent?.trim() || "";
      if (cls.includes("bibs")) classBib = parseInt(text) || 0;
      if (cls.includes("pnt") && !cls.includes("uci")) classPts = parseInt(text) || 0;
    }
    if ((classBib > 0 || classSlug) && classPts > 0) {
      const existing = results.find(r =>
        (classSlug && r.pcs_slug === classSlug) || (classBib > 0 && r.bib_number === classBib)
      );
      if (existing) existing[field] = classPts;
    }
  }
}

// Bonification tab: sometimes PCS exposes a "BONIS" tab with the full breakdown
// (finish + intermediate sprints). When present, it overrides the per-row "bonis"
// cell value so intermediate sprint bonuses are also counted.
export function extractBonifications(bonisTable: any, results: StageResult[]) {
  if (!bonisTable) return;
  const bonusRows = bonisTable.querySelectorAll("tbody tr");
  for (const row of bonusRows) {
    const cells = row.querySelectorAll("td");
    let bBib = 0, bPts = 0, bSlug: string | null = null;
    const riderLink = row.querySelector("a[href*='rider/']");
    if (riderLink) {
      const href = riderLink.getAttribute("href") || "";
      bSlug = href.replace(/^.*rider\//, "").trim() || null;
    }
    for (const cell of cells) {
      const cls = cell.className || "";
      const text = cell.textContent?.trim() || "";
      if (cls.includes("bibs")) bBib = parseInt(text) || 0;
      // The bonus column in this tab uses class "bonis" or "pnt" depending on PCS version
      if ((cls.includes("bonis") || cls.includes("pnt")) && !cls.includes("uci")) {
        const n = parseInt(text.replace(/[^\d]/g, "")) || 0;
        if (n > bPts) bPts = n;
      }
    }
    if ((bBib > 0 || bSlug) && bPts > 0) {
      const existing = results.find(r =>
        (bSlug && r.pcs_slug === bSlug) || (bBib > 0 && r.bib_number === bBib)
      );
      if (existing) existing.bonification_seconds = bPts;
    }
  }
}

// Volledige pagina-parse: tab-selectie (STAGE/TTT), uitslag, punten, KOM, bonificaties.
// Gooit Error met Nederlandse melding bij ontbrekende of onvolledige data.
export function parseStagePage(doc: any): StageResult[] {
  const hasTabs = doc.querySelectorAll("ul.restabs li a, ul.resultTabs li a").length > 0;
  const stageDiv = findTabDiv(doc, "STAGE") || findTabDiv(doc, "ÉTAPE") || findTabDiv(doc, "ETAPA")
    || findTabDiv(doc, "ETAPPE") || findTabDiv(doc, "PROLOGUE");

  // Gebruik de STAGE-tab als die bestaat, anders de eerste table.results
  // (zonder tab-selectie pakt de scraper de GC-tabel bij etappes met meerdere tabs)
  const table = stageDiv?.querySelector("table.results") || (!hasTabs ? doc.querySelector("table.results") : null);
  const tttList = !table
    ? (stageDiv?.querySelector("ul.ttt-results") || doc.querySelector("ul.ttt-results"))
    : null;

  if (!table && !tttList) {
    throw new Error("Geen resultaten-tabel gevonden op deze pagina");
  }

  const { results, winnerTime } = tttList ? parseTttResults(tttList) : parseTableResults(table);

  // Als winnerTime=0 zijn er geen tijden gevonden → waarschijnlijk startlijst i.p.v. uitslagen
  if (winnerTime === 0 && results.length > 0) {
    throw new Error("Geen tijden gevonden — PCS toont waarschijnlijk nog de startlijst. Wacht tot de etappe klaar is en probeer opnieuw.");
  }

  extractClassificationPoints(findTabTable(doc, "POINTS"), results, "points");
  extractClassificationPoints(findTabTable(doc, "KOM"), results, "mountain_points");
  extractBonifications(findTabTable(doc, "BONIS") || findTabTable(doc, "BONIFICATION"), results);

  return results;
}
