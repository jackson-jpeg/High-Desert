/**
 * Where each row and each group header sits in the virtual list.
 *
 * Every group gets a header, inline, directly above its first row — not only
 * the one sticky header for whichever group is at the top. With one header, a
 * "Played 2–4 times (2)" stayed pinned over the rows that followed it whatever
 * they were, and nothing marked where the next group began.
 *
 * Headers take their own slot (`headerHeight`) between rows of `rowHeight`.
 * Row *indices* are untouched — keyboard focus, shift-click ranges and
 * `aria-posinset` all keep counting episodes — only the pixel offsets change,
 * and every offset calculation goes through this module: the virtual window,
 * scroll-to-row, the rail, and scroll-to-current.
 *
 * `groupStarts` is each group's first row index, ascending. With no groups
 * this is exactly the old `i * rowHeight` layout.
 */

export type Slot = { kind: "row"; index: number } | { kind: "header"; group: number };

export interface ListLayout {
  totalHeight: number;
  /** Top of row `i`. */
  rowTop(i: number): number;
  /** Top of group `g`'s header. */
  headerTop(g: number): number;
  /** What is at vertical offset `y` (clamped to the list). */
  at(y: number): Slot;
  /** The first *row* at or below `y`: a header resolves to its group's first row. */
  rowAt(y: number): number;
}

export function buildListLayout(
  rowCount: number,
  groupStarts: readonly number[],
  rowHeight: number,
  headerHeight: number,
): ListLayout {
  const G = groupStarts.length;
  const hh = G > 0 ? headerHeight : 0;
  const totalHeight = rowCount * rowHeight + G * hh;

  /** Groups whose first row is ≤ i, i.e. headers above row i. */
  const headersAbove = (i: number): number => {
    let lo = 0;
    let hi = G - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (groupStarts[mid] <= i) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found + 1;
  };

  const rowTop = (i: number) => i * rowHeight + headersAbove(i) * hh;
  const headerTop = (g: number) => groupStarts[g] * rowHeight + g * hh;

  const at = (yRaw: number): Slot => {
    if (rowCount <= 0) return { kind: "row", index: 0 };
    const y = Math.max(0, Math.min(yRaw, totalHeight - 1));
    // Last header starting at or above y.
    let lo = 0;
    let hi = G - 1;
    let g = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (headerTop(mid) <= y) {
        g = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (g < 0) return { kind: "row", index: Math.min(rowCount - 1, Math.floor(y / rowHeight)) };
    const top = headerTop(g);
    if (y < top + hh) return { kind: "header", group: g };
    const end = g + 1 < G ? groupStarts[g + 1] : rowCount;
    const index = groupStarts[g] + Math.floor((y - top - hh) / rowHeight);
    return { kind: "row", index: Math.min(end - 1, index) };
  };

  const rowAt = (y: number): number => {
    const s = at(y);
    return s.kind === "row" ? s.index : groupStarts[s.group];
  };

  return { totalHeight, rowTop, headerTop, at, rowAt };
}
