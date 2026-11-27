import type { LiveMessage } from "@/services/live/client";

/**
 * The phone lines' switchboard (docs/UI-PLAN.md, push 2): one lamp per line,
 * lit while someone has called on it lately. The labels are the chat
 * service's own (services/live/lib/names.mjs, LINES), in its order;
 * switchboard.test.ts holds this copy equal to that list.
 */
export const SWITCHBOARD_LINES = [
  "Line 1",
  "Line 2",
  "Line 3",
  "Line 4",
  "Line 5",
  "Line 6",
  "West of the Rockies",
  "East of the Rockies",
  "Wildcard Line",
  "First-Time Callers",
  "International Line",
  "Area 51 Line",
] as const;

/** How long a line stays lit after a call on it. */
export const LAMP_LIT_MS = 20 * 60_000;

/** The lines with a call in the last `LAMP_LIT_MS` before `now`. */
export function litLines(messages: readonly Pick<LiveMessage, "at" | "line">[], now: number): Set<string> {
  const lit = new Set<string>();
  for (const m of messages) {
    const at = Date.parse(m.at);
    if (Number.isFinite(at) && now - at <= LAMP_LIT_MS && at <= now + 60_000) lit.add(m.line);
  }
  return lit;
}
