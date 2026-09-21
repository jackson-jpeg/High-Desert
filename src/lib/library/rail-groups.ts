/**
 * The library rail: a projection of the list, never a second opinion on it.
 *
 * The rail used to build a year → count histogram and sort its keys ascending
 * on its own, beside a list that runs newest first — so in the default view
 * the indicator climbed the rail while the list scrolled down ("the scroll
 * direction and the timeline rail on the right run opposite ways",
 * docs/timeline-rail.md). A histogram has no notion of *where* a year is, so in
 * Name/Guest order it listed twenty years for a list that changed year a
 * thousand times.
 *
 * `deriveRailGroups()` therefore walks the exact array the list renders, in
 * order, and emits one group per run of consecutive rows sharing a key, with
 * the index of the run's first row. Top of the rail is top of the list by
 * construction, in every sort, including ones added later.
 *
 * What a group *is* depends on the sort (`railKind`). If the list is not
 * actually grouped by that key — a key that comes back after another has
 * started — there is no honest rail to draw and the result is empty.
 */

import type { Episode } from "@/db/schema";
import type { SortMode } from "@/lib/library/filter-episodes";

export type RailKind = "year" | "letter" | "guest-letter" | "rating" | "recency" | "plays";

export interface RailGroup {
  /** Stable identity of the group, e.g. "1997", "C", "5". Exposed as `data-group`. */
  key: string;
  /** Short label that fits the 44px rail, e.g. "’97", "C", "5★". */
  label: string;
  /** Long form for the tooltip and the sticky header, e.g. "1997", "Rated 5 stars". */
  title: string;
  /** Index into the rendered array of this group's first row. */
  firstIndex: number;
  /** Rows in the run. */
  count: number;
}

/**
 * Which grouping the list's order supports, or null for none.
 *
 * A series filter overrides the sort mode (`sortEpisodes`): it orders by part,
 * which is air order in practice, so it gets a year rail — if a series ever
 * broadcast its parts out of order, the repeated year empties the rail rather
 * than drawing a wrong one.
 *
 * "progress" has no rail: it is a short work list (the shows you stopped
 * partway through), ordered by when you last touched them, and a rail over a
 * dozen rows is noise.
 */
export function railKind(sortMode: SortMode, seriesFilter: string | null = null): RailKind | null {
  if (seriesFilter) return "year";
  switch (sortMode) {
    case "date":
    case "date-asc":
      return "year";
    case "name":
      return "letter";
    case "guest":
      return "guest-letter";
    case "rated":
      return "rating";
    case "recent":
      return "recency";
    case "played":
      return "plays";
    case "progress":
      return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Initial for an A–Z rail. Accents fold to their base letter; digits and punctuation share "#". */
function initial(text: string): string {
  const ch = text.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  if (!ch) return "";
  return /\p{L}/u.test(ch) ? ch : "#";
}

interface KeyLabel {
  key: string;
  label: string;
  title: string;
}

function keyFor(ep: Episode, kind: RailKind, now: number): KeyLabel {
  switch (kind) {
    case "year": {
      const y = ep.airDate?.slice(0, 4);
      return y ? { key: y, label: `’${y.slice(2)}`, title: y } : { key: "Unknown", label: "?", title: "Unknown date" };
    }
    case "letter": {
      const k = initial(ep.title || ep.fileName);
      return { key: k || "#", label: k || "#", title: k === "#" || !k ? "Titles starting with a digit or symbol" : `Titles starting with ${k}` };
    }
    case "guest-letter": {
      const k = initial(ep.guestName || "");
      if (!k) return { key: "none", label: "—", title: "No guest" };
      return { key: k, label: k, title: k === "#" ? "Guests starting with a digit or symbol" : `Guests starting with ${k}` };
    }
    case "rating": {
      const r = Math.round(ep.rating ?? 0);
      if (r <= 0) return { key: "unrated", label: "—", title: "Unrated" };
      return { key: String(r), label: `${r}★`, title: `Rated ${r} star${r === 1 ? "" : "s"}` };
    }
    case "recency": {
      // Buckets are monotonic in lastPlayedAt, which is what "recent" sorts by
      // (descending), so each bucket is one run.
      const at = ep.lastPlayedAt ?? 0;
      if (at <= 0) return { key: "never", label: "Never", title: "Never played" };
      const age = now - at;
      if (age < DAY_MS) return { key: "day", label: "Today", title: "Played in the last 24 hours" };
      if (age < 7 * DAY_MS) return { key: "week", label: "7d", title: "Played in the last week" };
      if (age < 30 * DAY_MS) return { key: "month", label: "30d", title: "Played in the last month" };
      return { key: "older", label: "Older", title: "Played more than a month ago" };
    }
    case "plays": {
      const n = ep.playCount ?? 0;
      if (n >= 10) return { key: "10+", label: "10+", title: "Played 10 or more times" };
      if (n >= 5) return { key: "5-9", label: "5–9", title: "Played 5–9 times" };
      if (n >= 2) return { key: "2-4", label: "2–4", title: "Played 2–4 times" };
      if (n === 1) return { key: "1", label: "1×", title: "Played once" };
      return { key: "0", label: "0", title: "Never played" };
    }
  }
}

/**
 * The rail for `rows`, which must be the array the list renders, in its order.
 *
 * Returns [] when the sort has no rail, when the list has fewer than two
 * groups (nothing to navigate), or when a key recurs after another group has
 * started — i.e. the list is not grouped by it, and any rail would lie.
 *
 * `now` is only read by the recency grouping; it is a parameter so tests do
 * not depend on the clock.
 */
export function deriveRailGroups(
  rows: readonly Episode[],
  sortMode: SortMode,
  seriesFilter: string | null = null,
  now: number = Date.now(),
): RailGroup[] {
  const kind = railKind(sortMode, seriesFilter);
  if (!kind) return [];

  const groups: RailGroup[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const { key, label, title } = keyFor(rows[i], kind, now);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.count++;
      continue;
    }
    if (seen.has(key)) return [];
    seen.add(key);
    groups.push({ key, label, title, firstIndex: i, count: 1 });
  }
  return groups.length > 1 ? groups : [];
}

/**
 * Index of the first row actually in view — not an overscan row.
 *
 * The rows start directly beneath the (sticky) column header, which sits in
 * the same scroller and is pinned over exactly the height it occupies, so the
 * header's height cancels: row `i` is the first visible one while
 * `scrollTop` is in `[i * itemHeight, (i + 1) * itemHeight)`.
 *
 * Reading `virtualItems[0]` instead reported the row `overscan` (5) rows above
 * the screen — five table rows on desktop, ~580px of cards on a phone — and in
 * a list shorter than a screen plus five rows it never left row 0 (HD-035).
 */
export function firstVisibleIndex(scrollTop: number, itemHeight: number, rowCount: number): number {
  if (rowCount <= 0 || itemHeight <= 0) return 0;
  return Math.min(rowCount - 1, Math.max(0, Math.floor(scrollTop / itemHeight)));
}

/** The group containing row `rowIndex`: the last group starting at or before it. -1 if there are none. */
export function activeGroupIndex(groups: readonly RailGroup[], rowIndex: number): number {
  let lo = 0;
  let hi = groups.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid].firstIndex <= rowIndex) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Which of `count` equal-height scrubber slots a pointer at `clientY` is over.
 * The mobile scrubber lays its labels out as equal slots down the track, so
 * the slot under the finger is the label under the finger. Clamped: dragging
 * past either end holds the first or last group.
 */
export function scrubberIndexAt(clientY: number, trackTop: number, trackHeight: number, count: number): number {
  if (count <= 0 || trackHeight <= 0) return -1;
  const slot = Math.floor(((clientY - trackTop) / trackHeight) * count);
  return Math.min(count - 1, Math.max(0, slot));
}
