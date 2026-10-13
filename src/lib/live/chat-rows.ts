import type { ArchiveLine, LiveMessage, LiveYou, TuneinNotice } from "@/services/live/client";

/**
 * What the phone lines draw, in order, for every surface and both looks
 * (LiveChat, NotepadPhoneLines, the phone's preview). Pure: the components
 * decide how a row looks, never which rows there are.
 */
export type ChatRow =
  | { kind: "call"; at: number; m: LiveMessage }
  /** One line for one or more tune-in notices in a row; `key` is the first one's time, so it holds still while more fold in. */
  | { kind: "tunein"; at: number; n: TuneinNotice; key: string; merged: number }
  | { kind: "archive"; at: number; a: ArchiveLine };

/** How many places a folded tune-in line names, the same as the service's batch (TUNEIN_PLACES_SHOWN). */
export const TUNEIN_PLACES_KEPT = 3;

/** Calls, tune-in lines and archive lines, in time order; calls keep their own (id) order among themselves. */
export function listRows(messages: LiveMessage[], notices: TuneinNotice[], archive: ArchiveLine[] = []): ChatRow[] {
  const rows: ChatRow[] = messages.map((m) => ({ kind: "call", at: Date.parse(m.at), m }));
  const place = (row: ChatRow) => {
    // After every row at or before it: a stable place, whatever the calls' clock.
    let i = rows.length;
    while (i > 0 && rows[i - 1].at > row.at) i--;
    rows.splice(i, 0, row);
  };
  for (const n of notices) place({ kind: "tunein", at: Date.parse(n.at), n, key: n.at, merged: 1 });
  for (const a of archive) place({ kind: "archive", at: Date.parse(a.at), a });
  return rows;
}

/**
 * Tune-in lines with nothing between them become one: three "A new listener
 * tuned in" in a row read "3 new listeners tuned in". Counts add up; places
 * are kept once each, at most TUNEIN_PLACES_KEPT. A call or an archive line
 * between two tune-ins keeps them apart.
 */
export function groupTuneins(rows: ChatRow[]): ChatRow[] {
  const out: ChatRow[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (r.kind === "tunein" && prev?.kind === "tunein") {
      const places = [...prev.n.places];
      for (const p of r.n.places) if (places.length < TUNEIN_PLACES_KEPT && !places.includes(p)) places.push(p);
      out[out.length - 1] = {
        kind: "tunein",
        at: r.at,
        n: { at: r.n.at, count: prev.n.count + r.n.count, places },
        key: prev.key,
        merged: prev.merged + r.merged,
      };
    } else {
      out.push(r);
    }
  }
  return out;
}

/** Every row the lines draw: `listRows`, with runs of tune-ins folded into one. */
export function chatRows(messages: LiveMessage[], notices: TuneinNotice[], archive: ArchiveLine[] = []): ChatRow[] {
  return groupTuneins(listRows(messages, notices, archive));
}

/** "Night Owl, calling from Asuncion", or just the name. */
export function callerLabel(m: Pick<LiveMessage, "name" | "place">): string {
  return m.place ? `${m.name}, calling from ${m.place}` : m.name;
}

/**
 * The line a call shows (2026-10-13, a caller's ask): only when the caller gave
 * no place. With a place, "calling from Reno" says where they are and the line
 * is left off to save room.
 */
export function shownLine(m: Pick<LiveMessage, "line" | "place">): string | null {
  return m.place ? null : m.line;
}

/** This browser's own call: one it posted, or one under the name it holds now (hello's `you`). */
export function isOwnCall(m: Pick<LiveMessage, "id" | "name">, mine: readonly number[], you: Pick<LiveYou, "name"> | null): boolean {
  return mine.includes(m.id) || (!!you && m.name === you.name);
}
