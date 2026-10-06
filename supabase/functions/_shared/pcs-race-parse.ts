// Parse-logica voor de race-import (sync-pcs-race) in de nieuwe PCS-layout
// (sinds ~eind sept 2026). Getest in supabase/functions/tests/pcs-race-parse.test.ts.
//
// Oude layout: <race>/<jaar>/stages had een table.basic met per etappe datum,
// type-icoon, naam en afstand. Nieuw: die URL is een (lege) statistiekpagina.
// De etappes staan wél in het etappe-keuzemenu dat op elke racepagina zit:
//   <option value="race/tour-of-guangxi-2026-stage-1/stages">Stage 1 | Chongzuo - Chongzuo</option>
// en de details per etappe op de etappepagina zelf, als label/waarde-paren:
//   <div class="bold mr5">Date</div><div>13 October 2026</div>
//   <div class="bold mr5">Start time: </div><div>10:30:00</div>
//   <div class="bold mr5">Distance:</div><div class="mr3">149.4</div><div>km</div>
//   <div class="bold mr5">Parcours type: </div><div><span class="icon profile p2 mg_rp4"></span></div>
//   <div class="bold mr5">Departure: </div><div><a href="location/chongzuo">Chongzuo</a></div>

export interface NavStage {
  stage_number: number;   // 0 = proloog
  name: string;           // routenaam, bv. "Chongzuo - Jingxi"
  departure: string | null;
  arrival: string | null;
  _href: string;          // etappepagina, bv. "race/tour-of-guangxi-2026-stage-2"
}

export function parseStageNav(doc: any): NavStage[] {
  const out: NavStage[] = [];
  const seen = new Set<number>();
  for (const opt of [...doc.querySelectorAll("option")] as any[]) {
    const value = (opt.getAttribute("value") || "").replace(/\/stages$/, "");
    const m = value.match(/^race\/.+-(?:stage-(\d+)|(prologue))$/);
    if (!m) continue;
    const stage_number = m[2] ? 0 : parseInt(m[1]);
    if (seen.has(stage_number)) continue;
    seen.add(stage_number);

    const text = (opt.textContent || "").replace(/\s+/g, " ").trim();
    const route = text.includes("|") ? text.split("|").slice(1).join("|").trim() : text;
    const parts = route.split(/\s+[-–›→]\s+/);
    out.push({
      stage_number,
      name: route,
      departure: parts.length >= 2 ? parts[0].trim() || null : null,
      arrival: parts.length >= 2 ? parts[parts.length - 1].trim() || null : null,
      _href: value,
    });
  }
  return out.sort((a, b) => a.stage_number - b.stage_number);
}

export interface StageInfo {
  date: string | null;        // ISO yyyy-mm-dd
  startTime: string | null;   // "HH:MM" (lokale tijd volgens PCS)
  distance_km: number | null;
  parcoursIcon: string;       // class van het type-icoon, bv. "icon profile p2"
  departure: string | null;
  arrival: string | null;
  vertical_meters: number | null;
  profile_score: number | null;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

// Waarde-elementen direct na het label-element ("Date", "Start time:" …)
function valueAfter(doc: any, label: string): any[] {
  for (const el of [...doc.querySelectorAll("div.bold")] as any[]) {
    const t = (el.textContent || "").replace(/[:\s]+$/, "").trim().toLowerCase();
    if (t !== label.toLowerCase()) continue;
    const vals: any[] = [];
    let n = el.nextElementSibling;
    while (n && n.tagName !== "BR" && !(n.classList?.contains("bold"))) {
      vals.push(n);
      n = n.nextElementSibling;
    }
    return vals;
  }
  return [];
}

const text = (els: any[]) => els.map(e => (e.textContent || "").trim()).join(" ").replace(/\s+/g, " ").trim();

export function parseStageInfo(doc: any): StageInfo {
  let date: string | null = null;
  const dateText = text(valueAfter(doc, "Date"));
  const dm = dateText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dm && MONTHS[dm[2].toLowerCase()]) date = `${dm[3]}-${MONTHS[dm[2].toLowerCase()]}-${dm[1].padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}/.test(dateText)) date = dateText.slice(0, 10);

  const tm = text(valueAfter(doc, "Start time")).match(/(\d{1,2}):(\d{2})/);
  const startTime = tm && !(tm[1] === "0" && tm[2] === "00") ? `${tm[1].padStart(2, "0")}:${tm[2]}` : null;

  const dist = parseFloat(text(valueAfter(doc, "Distance")));
  const parcoursIcon = valueAfter(doc, "Parcours type")
    .map(e => e.querySelector("span.icon")?.getAttribute("class") || "").find(Boolean) || "";
  const vm = parseInt(text(valueAfter(doc, "Vertical meters")));
  const ps = parseInt(text(valueAfter(doc, "Profile score")) || text(valueAfter(doc, "ProfileScore")));

  return {
    date,
    startTime,
    distance_km: isFinite(dist) && dist > 0 ? dist : null,
    parcoursIcon,
    departure: text(valueAfter(doc, "Departure")) || null,
    arrival: text(valueAfter(doc, "Arrival")) || null,
    vertical_meters: isFinite(vm) ? vm : null,
    profile_score: isFinite(ps) ? ps : null,
  };
}

// Etappetype uit het PCS-profielicoon (p1 vlak … p5 bergop) + naam (TT/TTT)
export function mapStageType(iconClass: string, name: string): string {
  const n = name.toLowerCase();
  if (n.includes("ttt") || n.includes("team time")) return "ttt";
  if (n.includes("itt") || n.includes("(tt)") || n.includes("time trial") || n.includes("tijdrit")) return "tt";
  // Alleen het losse class-token p1..p5 — de nieuwe PCS-layout zet er o.a. "mg_rp4"
  // (marge-class) naast, waar een includes("p4") ten onrechte op matchte (Guangxi:
  // alle etappes werden "mountain").
  const p = iconClass.match(/(?:^|\s)p([1-5])(?:\s|$)/)?.[1];
  if (p === "5" || p === "4") return "mountain";
  if (p === "3") return "hills";
  if (p === "2") return "sprint";
  return "flat";
}
