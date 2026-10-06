// Tests voor localToUtc (lokale PCS-starttijd → UTC). Draaien met:
//   deno test --allow-read supabase/functions/tests/
import { assertEquals } from "jsr:@std/assert";
import { localToUtc } from "../_shared/tz.ts";

Deno.test("tz: Tour of Guangxi — 10:30 in China = 02:30 UTC (04:30 NL)", () => {
  assertEquals(localToUtc("2026-10-13", "10:30", "Asia/Shanghai").toISOString(), "2026-10-13T02:30:00.000Z");
});

Deno.test("tz: Europa zomer- en wintertijd (zelfde als het oude CET/CEST-gedrag)", () => {
  assertEquals(localToUtc("2026-07-05", "13:00", "Europe/Paris").toISOString(), "2026-07-05T11:00:00.000Z");
  assertEquals(localToUtc("2026-03-21", "10:30", "Europe/Rome").toISOString(), "2026-03-21T09:30:00.000Z");
  // Dag na de overgang naar wintertijd (25 okt 2026)
  assertEquals(localToUtc("2026-10-26", "12:00", "Europe/Amsterdam").toISOString(), "2026-10-26T11:00:00.000Z");
});

Deno.test("tz: zuidelijk halfrond en negatieve offset", () => {
  // Tour Down Under (januari = zomertijd, UTC+10:30)
  assertEquals(localToUtc("2026-01-20", "11:00", "Australia/Adelaide").toISOString(), "2026-01-20T00:30:00.000Z");
  // GP Québec (september, UTC-4)
  assertEquals(localToUtc("2026-09-11", "11:00", "America/Toronto").toISOString(), "2026-09-11T15:00:00.000Z");
});

Deno.test("tz: lege of onbekende tijdzone → Europe/Amsterdam", () => {
  assertEquals(localToUtc("2026-07-05", "13:00", null).toISOString(), "2026-07-05T11:00:00.000Z");
  assertEquals(localToUtc("2026-07-05", "13:00", "Mars/Olympus").toISOString(), "2026-07-05T11:00:00.000Z");
});
