// Tijdzone-hulp voor de race-import. PCS toont starttijden in de LOKALE tijd van
// de koers; competitions.timezone (IANA, bv. "Asia/Shanghai") bepaalt hoe die naar
// UTC gaat. Getest in supabase/functions/tests/tz.test.ts.

export const DEFAULT_TIMEZONE = "Europe/Amsterdam";

// UTC-offset ("+08:00", "-05:00") van een tijdzone op een bepaald moment
function offsetAt(instant: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant).find(p => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || "00"}` : "+00:00";
}

function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// Lokale wandkloktijd (datum + "HH:MM") in een tijdzone → absolute Date.
// Onbekende/lege tijdzone → DEFAULT_TIMEZONE (gedrag van vóór deze functie).
export function localToUtc(dateISO: string, timeHHMM: string, timeZone?: string | null): Date {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  // Offset bepalen rond het bedoelde moment; tweede ronde vangt een zomer/wintertijd-
  // overgang tussen de gok (als UTC gelezen) en het echte moment af.
  const guess = new Date(`${dateISO}T${timeHHMM}:00Z`);
  let offset = offsetAt(guess, tz);
  let result = new Date(`${dateISO}T${timeHHMM}:00${offset}`);
  const offset2 = offsetAt(result, tz);
  if (offset2 !== offset) {
    offset = offset2;
    result = new Date(`${dateISO}T${timeHHMM}:00${offset}`);
  }
  return result;
}
