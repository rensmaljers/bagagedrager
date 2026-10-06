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

// Nieuwe PCS-layout (sinds ~eind sept 2026): /results/dropouts stuurt door naar de
// algemene uitslag en de nieuwe statistiekpagina (…-gc/stages/dropouts) is leeg.
// De startlijst markeert uitvallers wél, achter de rennernaam in hetzelfde <li>:
//   <a href="rider/kaden-groves">GROVES Kaden</a> (DNF #9)
//   <a href="rider/pablo-torres-arias">TORRES Pablo</a>* (DNS #12)
// "#N" is het etappenummer; ontbreekt het, dan is stage_number null. "#P" voor
// de proloog is een aanname (nog niet op PCS gezien) en geeft stage_number 0.
const STARTLIST_MARK = /\((DNF|DNS|OTL|DSQ)(?:\s*#\s*(\d+|P))?\)/i;

export function parseStartlistDropouts(doc: any): Dropout[] {
  const out: Dropout[] = [];
  const seen = new Set<string>();
  for (const a of [...doc.querySelectorAll('a[href*="rider/"]')] as any[]) {
    const li = a.closest("li");
    if (!li) continue;
    const m = (li.textContent || "").match(STARTLIST_MARK);
    if (!m) continue;
    const slug = (a.getAttribute("href") || "").split("rider/")[1]?.split(/[/?#]/)[0];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const stage_number = m[2] === undefined ? null : m[2].toUpperCase() === "P" ? 0 : parseInt(m[2]);
    out.push({ pcs_slug: slug, name: a.textContent.trim(), type: m[1].toUpperCase(), stage_number });
  }
  return out;
}

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
