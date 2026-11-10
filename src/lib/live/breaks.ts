/**
 * Station Breaks (2026-11-09, docs/station-breaks.md): a sponsor spot for one
 * of Jackson's apps, aired between shows, never inside one. Pure, shared by
 * the server (which places breaks in the published schedule) and the browser
 * (which plays the spot in the gap and draws the chat card).
 *
 * ## When
 *
 * Picked from Live's listener profile (`/api/stats/traffic`, 30 days, read
 * 2026-11-09): listening peaks at 8 to 9 PM Pacific (about 11 listening) and
 * holds near 10 until 12:30 AM Pacific. So:
 *
 *   - **evening**: the show boundary nearest 8 PM Pacific, within
 *     EVENING_WINDOW, every day;
 *   - **late**: midnight Pacific (3 AM Eastern: "still up at 3 a.m.?"), the
 *     top of the station day, some days.
 *
 * Audio one or two a day; the chat card on five of them a week (Jackson,
 * 2026-11-09: "audio ads only like 1-2 a day, and the chats 4-5 times a
 * week"). Rotation in WEEK, by the Pacific station day's weekday: SoGoJet
 * most, Screen Receipts in the late slot, Sim Sunday once a week, on Sunday.
 *
 * ## How it fits the clock
 *
 * A break sits where one show ends: the spot, a pad, then the usual station
 * ID before the next show. The shows after it move later by the break's
 * length until a gap absorbs it (the slack before 10 PM, usually minutes),
 * the same way `applyRequest` moves the night. **The 10 PM request slot never
 * moves**: a break is placed before it only where it fits, and the show before
 * 10 PM is never shortened for one. After 10 PM the night moves on toward
 * midnight, where the last show is cut as it always is. Applied at read time
 * after the request (src/services/live/days.ts), so the breaker and every
 * client see the same times. Deterministic in the day.
 *
 * ## Off the air, for now (2026-11-10)
 *
 * `AIR_SPOTS` is false (Jackson, after the first spot: listening went from 20
 * to 10 at the break and stayed near 13; no other show change that day
 * moved; "Lol was that an ad" in the lines). The chat cards stay, "as long as
 * it doesn't interrupt the show": the program is left exactly as frozen,
 * nothing plays, and each card break sits in the station ID gap at its
 * boundary with `url: null`. Set it true to put the spots back on the air.
 */

import { STATION_ID_SEC } from "./schedule";
import type { DayProgram, ProgramSlot } from "./schedule";
import { pacificDayBounds, parts, requestStartAt } from "./pacific";
import { SPONSORS, type SponsorId } from "@/lib/support/sponsors";
import spotAudio from "@/data/station-break-audio.json";

/** Silence after the spot before the station ID, seconds. */
export const BREAK_PAD_SEC = 1;
/** The evening break's target: 8 PM Pacific. */
export const EVENING_HOUR = 20;
/** How far from 8 PM the evening break may land: a boundary 90 min before to 150 min after. */
export const EVENING_WINDOW = { beforeMs: 90 * 60_000, afterMs: 150 * 60_000 };

/**
 * No break starts before this instant (2 PM Pacific on the day they shipped):
 * an earlier day's program, and the show on the air at the deploy, keep the
 * times they had. Without it, today's already-past midnight break would have
 * moved every show since midnight, the one playing included.
 */
export const BREAKS_FROM_MS = Date.UTC(2026, 10, 9, 22, 0, 0);

/** Play the spots on the air. False: chat cards only, the program untouched (see the header). */
export const AIR_SPOTS = false;

/** A cut show trimmed for a break keeps at least this much air. */
export const MIN_KEEP_MS = 5 * 60_000;

export type BreakSlot = "evening" | "late";

interface PlanEntry {
  spot: SponsorId;
  /** Post the chat card for this one. */
  card: boolean;
}

/** By weekday of the Pacific station day, 0 = Sunday. 11 spots a week, 5 cards. */
export const WEEK: readonly { evening: PlanEntry; late: PlanEntry | null }[] = [
  /* Sun */ { evening: { spot: "simsunday", card: true }, late: null },
  /* Mon */ { evening: { spot: "sogojet", card: false }, late: { spot: "screenreceipts", card: true } },
  /* Tue */ { evening: { spot: "sogojet", card: true }, late: null },
  /* Wed */ { evening: { spot: "sogojet", card: false }, late: { spot: "screenreceipts", card: false } },
  /* Thu */ { evening: { spot: "sogojet", card: true }, late: { spot: "sogojet", card: false } },
  /* Fri */ { evening: { spot: "sogojet", card: false }, late: { spot: "screenreceipts", card: true } },
  /* Sat */ { evening: { spot: "sogojet", card: false }, late: null },
];

export interface SpotAudio {
  id: string;
  cart: string;
  durationSec: number;
  url: string;
}

/** The rendered spots (scripts/make-station-breaks.mjs writes the file). */
export const SPOT_AUDIO: Readonly<Record<string, SpotAudio>> = spotAudio;

/** One break on the air. Times are epoch ms on the server's clock. */
export interface StationBreak {
  /** `<day>:<slot>`, stable: what impressions and the card key on. */
  id: string;
  day: string;
  slot: BreakSlot;
  spot: SponsorId;
  cart: string;
  /** The spot's file, on this origin; null when spots are off the air (a card only). */
  url: string | null;
  durationSec: number;
  card: boolean;
  /** When the spot starts: the previous show's end (or midnight). */
  start: number;
  /** When the spot is over; the station ID follows, then the next show. */
  end: number;
}

export function weekday(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** What `day` airs, before it is placed: slot, spot and card. */
export function planFor(day: string): { slot: BreakSlot; entry: PlanEntry }[] {
  const w = WEEK[weekday(day)];
  const out: { slot: BreakSlot; entry: PlanEntry }[] = [];
  if (w.late) out.push({ slot: "late", entry: w.late });
  out.push({ slot: "evening", entry: w.evening });
  return out;
}

/** The break's length in the timeline: the spot and its pad (the station ID is the gap's own). */
function breakMs(audio: SpotAudio): number {
  return Math.round((audio.durationSec + BREAK_PAD_SEC) * 1000);
}

/**
 * Shift the slots from index `i` so the first starts no earlier than
 * `minStart`, carrying on until a gap absorbs the shift. Slots at or after
 * `anchor` never move; returns null when the shift would push a slot into one
 * (the break does not fit here). After the last anchor (`dayEnd`), slots are
 * clipped at it as the day always clips its last show, and any that would
 * start at or past it drop off.
 */
function shiftFrom(
  slots: ProgramSlot[],
  i: number,
  minStart: number,
  anchor: number,
  dayEnd: number,
): ProgramSlot[] | null {
  const gap = STATION_ID_SEC * 1000;
  const out = slots.slice(0, i);
  let next = minStart;
  let j = i;
  for (; j < slots.length; j++) {
    const s = slots[j];
    if (s.start >= next) break; // absorbed
    if (s.start >= anchor && anchor < dayEnd) return null; // would move the 10 PM slot
    const length = Math.round(s.duration * 1000);
    const start = next;
    let end = Math.min(start + (s.end - s.start), dayEnd);
    if (anchor < dayEnd && end + gap > anchor) {
      // Only a show the day already cut short before 10 PM (buildDay's
      // MIN_CUT_MS rule) may lose a little more of its cut end; one playing
      // in full is never shortened for a break, and nothing moves 10 PM.
      const alreadyCut = s.end - s.start < length;
      if (!alreadyCut || anchor - gap - start < MIN_KEEP_MS) return null;
      end = anchor - gap;
    }
    if (start >= dayEnd) {
      j = slots.length; // the rest drop off, as the day's overrun always does
      break;
    }
    out.push({ ...s, start, end });
    // From where this one stops airing: its full length, or its cut end.
    next = end + gap;
  }
  return out.concat(slots.slice(j));
}

/**
 * The day with its breaks placed. Returns the program (slots moved where a
 * break needed room) and the breaks, in time order. A break that fits nowhere
 * near its target is left out for the day rather than cut into a show.
 */
export function applyBreaks(
  program: DayProgram,
  audio: Readonly<Record<string, SpotAudio>> = SPOT_AUDIO,
  air: boolean = AIR_SPOTS,
): { program: DayProgram; breaks: StationBreak[] } {
  const { start: dayStart, end: dayEnd } = pacificDayBounds(program.day);
  const tenPm = requestStartAt(program.day);
  const gap = STATION_ID_SEC * 1000;
  let slots = [...program.slots];
  const breaks: StationBreak[] = [];

  for (const { slot, entry } of planFor(program.day)) {
    const a = audio[entry.spot];
    if (!a || !(a.durationSec > 0) || !SPONSORS[entry.spot]) continue;
    if (!air && !entry.card) continue; // nothing to show for an audio-only break
    const len = breakMs(a);

    // Candidate boundaries: index i means "before slots[i]" (i = 0 is midnight).
    let candidates: number[];
    if (slot === "late") {
      candidates = slots.length && slots[0].start === dayStart ? [0] : [];
    } else {
      const target = dayEnd - (24 - EVENING_HOUR) * 3_600_000;
      candidates = slots
        .map((s, i) => ({ i, d: s.start - target }))
        .filter(({ i, d }) => i > 0 && d >= -EVENING_WINDOW.beforeMs && d <= EVENING_WINDOW.afterMs)
        .sort((x, y) => Math.abs(x.d) - Math.abs(y.d) || x.i - y.i)
        .map(({ i }) => i);
    }

    for (const i of candidates) {
      const start = i === 0 ? dayStart : slots[i - 1].end;
      if (start < BREAKS_FROM_MS) continue;
      if (breaks.some((b) => start < b.end + gap && b.start < start + len + gap)) continue;
      if (air) {
        // A boundary at or before 10 PM answers to 10 PM, which never moves.
        const anchor = slots[i].start <= tenPm ? tenPm : dayEnd;
        const moved = shiftFrom(slots, i, start + len + gap, anchor, dayEnd);
        if (!moved) continue;
        slots = moved;
      }
      breaks.push({
        id: `${program.day}:${slot}`,
        day: program.day,
        slot,
        spot: entry.spot,
        cart: a.cart,
        url: air ? a.url : null,
        durationSec: a.durationSec,
        card: entry.card,
        start,
        end: start + Math.round(a.durationSec * 1000),
      });
      break;
    }
  }
  breaks.sort((x, y) => x.start - y.start);
  return { program: breaks.length ? { ...program, slots } : program, breaks };
}

/**
 * The break the station is in at `at`, if the gap it is in holds one that
 * has not finished: what the controller plays instead of going straight to
 * the station ID.
 */
export function breakInGap(breaks: readonly StationBreak[], from: number, until: number): StationBreak | null {
  // A card-only break (url null) has nothing to play.
  return breaks.find((b) => b.url && b.end > from && b.start < until) ?? null;
}
