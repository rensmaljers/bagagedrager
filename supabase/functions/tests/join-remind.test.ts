// Tests voor de inschrijf-pushes (auto-join-remind). Draaien met:
//   deno test --allow-read supabase/functions/tests/
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildJoinPayload, decideJoinPush, formatStartNl } from "../_shared/join-remind.ts";

const now = new Date("2026-10-10T12:00:00Z");
const comp = (o: Partial<{ is_active: boolean; join_open_notified_at: string | null; join_reminder_sent_at: string | null }> = {}) =>
  ({ is_active: true, join_open_notified_at: null, join_reminder_sent_at: null, ...o });
const stage = (deadline: string, locked = false) => ({ deadline, locked });

Deno.test("join: ronde ver weg → eerst 'open', daarna niets tot het venster", () => {
  const stages = [stage("2026-10-13T02:30:00Z"), stage("2026-10-14T03:10:00Z")];
  assertEquals(decideJoinPush(comp(), stages, now), "open");
  assertEquals(decideJoinPush(comp({ join_open_notified_at: "x" }), stages, now), null);
});

Deno.test("join: binnen 24 uur vóór de start → 'reminder' (eenmalig)", () => {
  const stages = [stage("2026-10-11T08:00:00Z")]; // 20u na now
  assertEquals(decideJoinPush(comp({ join_open_notified_at: "x" }), stages, now), "reminder");
  assertEquals(decideJoinPush(comp({ join_open_notified_at: "x", join_reminder_sent_at: "y" }), stages, now), null);
});

Deno.test("join: pas binnen het venster geactiveerd → alleen 'reminder', geen dubbele melding", () => {
  const stages = [stage("2026-10-11T08:00:00Z")];
  assertEquals(decideJoinPush(comp(), stages, now), "reminder");
});

Deno.test("join: gestart, inactief of zonder etappes → niets", () => {
  assertEquals(decideJoinPush(comp(), [stage("2026-10-10T11:00:00Z")], now), null);           // deadline voorbij
  assertEquals(decideJoinPush(comp(), [stage("2026-10-12T08:00:00Z", true)], now), null);     // vergrendeld
  assertEquals(decideJoinPush(comp({ is_active: false }), [stage("2026-10-13T08:00:00Z")], now), null);
  assertEquals(decideJoinPush(comp(), [], now), null);
});

Deno.test("join: berichttekst met starttijd in Nederlandse tijd", () => {
  const start = new Date("2026-10-13T02:30:00Z"); // 04:30 CEST
  assertEquals(formatStartNl(start), "dinsdag 13 oktober om 04:30");
  const open = buildJoinPayload("open", "Tour of Guangxi", start);
  assertStringIncludes(open.title, "Inschrijving geopend: Tour of Guangxi");
  assertStringIncludes(open.body, "dinsdag 13 oktober om 04:30");
  assertEquals(open.url, "/#dashboard");
  assertStringIncludes(buildJoinPayload("reminder", "Tour of Guangxi", start).title, "Laatste kans");
});
