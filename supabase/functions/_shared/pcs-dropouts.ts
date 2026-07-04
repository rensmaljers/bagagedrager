// Parser voor de PCS dropouts-pagina: <race-base>/results/dropouts
// Structuur (vastgelegd 4 juli 2026 op tour-de-france/2025):
//   table.basic met kolommen  # | Stage | Rider | Type | Reason | Injury
//   - Stage-cel: <a href=".../stage-5">Stage 5 (ITT)</a> (proloog: "Prologue")
//   - Rider-cel: <a href="rider/<pcs_slug>">NAAM Voornaam</a>
//   - Type-cel: DNF / DNS / OTL / DSQ
// De tabel wordt op inhoud herkend (Rider+Type-koppen), niet op positie —
// de pagina bevat soms meerdere .basic-tabellen.

export interface Dropout {
  pcs_slug: string;
  name: string;
  type: string;          // DNF | DNS | OTL | DSQ
  stage_number: number | null; // 0 = proloog, null = niet te bepalen
}

const TYPES = new Set(["DNF", "DNS", "OTL", "DSQ"]);

export function parseDropoutsPage(doc: any): Dropout[] {
  const tables = [...doc.querySelectorAll("table")];
  const table = tables.find((t: any) => {
    const ths = [...t.querySelectorAll("th")].map((th: any) => th.textContent.trim().toLowerCase());
    return ths.includes("rider") && ths.includes("type");
  });
  if (!table) return [];

  const out: Dropout[] = [];
  for (const tr of [...table.querySelectorAll("tbody tr")]) {
    const riderA = tr.querySelector('a[href*="rider/"]');
    if (!riderA) continue;
    const slug = (riderA.getAttribute("href") || "").split("rider/")[1]?.split(/[/?#]/)[0];
    if (!slug) continue;

    const type = [...tr.querySelectorAll("td")]
      .map((td: any) => td.textContent.trim().toUpperCase())
      .find((t: string) => TYPES.has(t));
    if (!type) continue;

    let stage_number: number | null = null;
    const stageA = tr.querySelector('a[href*="stage-"], a[href*="prologue"]');
    if (stageA) {
      const href = stageA.getAttribute("href") || "";
      if (/prologue/.test(href)) stage_number = 0;
      else {
        const m = href.match(/stage-(\d+)/);
        if (m) stage_number = parseInt(m[1]);
      }
    }

    out.push({ pcs_slug: slug, name: riderA.textContent.trim(), type, stage_number });
  }
  return out;
}
