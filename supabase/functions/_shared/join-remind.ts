// Beslislogica + berichttekst voor de inschrijf-pushes (auto-join-remind).
// Getest in supabase/functions/tests/join-remind.test.ts.
//
// Per actieve ronde die nog niet gestart is (en al etappes heeft):
//   "open"     — eenmalig zodra de ronde actief is: inschrijving geopend
//   "reminder" — eenmalig binnen REMINDER_WINDOW_MS vóór de eerste deadline:
//                laatste kans voor wie nog niet ingeschreven is
// Valt de activering zelf al binnen het venster, dan alleen "reminder" (geen
// twee berichten vlak na elkaar); de "open"-vlag wordt dan ook gezet.

export const REMINDER_WINDOW_MS = 24 * 3600 * 1000;

export interface JoinComp {
  is_active: boolean;
  join_open_notified_at: string | null;
  join_reminder_sent_at: string | null;
}

export interface JoinStage {
  deadline: string;
  locked: boolean;
}

export type JoinPushKind = "open" | "reminder";

export function firstDeadline(stages: JoinStage[]): Date | null {
  const times = stages.map((s) => new Date(s.deadline).getTime()).filter((t) => !isNaN(t));
  return times.length ? new Date(Math.min(...times)) : null;
}

export function decideJoinPush(comp: JoinComp, stages: JoinStage[], now: Date): JoinPushKind | null {
  if (!comp.is_active || !stages.length) return null;
  const start = firstDeadline(stages);
  if (!start) return null;
  // Gestart (een etappe vergrendeld of eerste deadline voorbij) → inschrijven kan niet meer
  if (stages.some((s) => s.locked) || start.getTime() <= now.getTime()) return null;

  const withinWindow = start.getTime() - now.getTime() <= REMINDER_WINDOW_MS;
  if (withinWindow && !comp.join_reminder_sent_at) return "reminder";
  if (!withinWindow && !comp.join_open_notified_at) return "open";
  return null;
}

// Starttijd leesbaar in Nederlandse tijd ("zaterdag 13 juni om 13:15")
export function formatStartNl(start: Date): string {
  const day = start.toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long" });
  const time = start.toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" });
  return `${day} om ${time}`;
}

export function buildJoinPayload(kind: JoinPushKind, compName: string, start: Date) {
  const when = formatStartNl(start);
  return kind === "open"
    ? {
        title: `📣 Inschrijving geopend: ${compName}`,
        body: `Doe je mee? Schrijf je in met "Ik doe mee" vóór de start (${when}).`,
        url: "/#dashboard",
      }
    : {
        title: `⏳ Laatste kans: ${compName}`,
        body: `Je bent nog niet ingeschreven. De ronde start ${when} — daarna kun je niet meer meedoen.`,
        url: "/#dashboard",
      };
}
