/**
 * The Request Line's words and its one rule for what the Live screens say
 * about tonight's 10 PM slot (docs/request-line.md). Pure: read from the
 * station's own published program, so the note on Live, the log and the
 * station's air can never disagree.
 */

import { REQUEST_CLOSE_HOUR, requestCloseAt, type ProgramSlot } from "@/lib/live/schedule";

export const REQUEST_LINE_PATH = "/request-line";
/** The share card's headline, and the share text. */
export const REQUEST_SHARE_TITLE = "Vote for my pick on High Desert";

export type TonightsRequestNote =
  /** Voting is open: tonight's slot is still up for grabs. */
  | { state: "voting"; closesAt: number; startsAt: number }
  /** Locked: the listeners' pick, and who asked for it. */
  | { state: "locked"; slot: ProgramSlot; startsAt: number }
  /** Nobody nominated (or the pick could not air): a fan favorite. */
  | { state: "favorite"; slot: ProgramSlot | null; startsAt: number }
  /** Tonight's request has aired. */
  | { state: "over" };

/**
 * What tonight's 10 PM slot is, from today's guide at `now`. The request slot
 * is the one with `kind: "request"` once voting has closed, or the one marked
 * `requestSlot` (the show on the hour) while it is open or on an empty night.
 */
export function tonightsRequest(guide: readonly ProgramSlot[], day: string, now: number): TonightsRequestNote {
  const won = guide.find((s) => s.kind === "request");
  const held = won ?? guide.find((s) => s.requestSlot);
  const startsAt = held?.start ?? requestCloseAt(day) + 4 * 3_600_000;
  if (held && now >= held.end) return { state: "over" };
  if (won) return { state: "locked", slot: won, startsAt };
  const closesAt = requestCloseAt(day);
  if (now < closesAt) return { state: "voting", closesAt, startsAt };
  return { state: "favorite", slot: held ?? null, startsAt };
}

/** One line for the Live note. No em dashes: periods and commas. */
export function tonightsRequestText(note: TonightsRequestNote): string | null {
  switch (note.state) {
    case "voting":
      return `Tonight's request at 10 PM. Pick a show or vote by ${REQUEST_CLOSE_HOUR - 12} PM Pacific.`;
    case "locked": {
      const r = note.slot.request;
      const who = r ? `, from ${r.by}${r.place ? `, calling from ${r.place}` : ""}` : "";
      return `Tonight's request at 10 PM: ${note.slot.title}${who}.`;
    }
    case "favorite":
      return "No request tonight. A fan favorite plays at 10 PM.";
    case "over":
      return null;
  }
}
