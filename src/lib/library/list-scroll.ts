/**
 * One handle for scrolling the episode list to a row.
 *
 * Row offsets are not `index × rowHeight` once group headers sit between the
 * rows (list-layout.ts), so nothing outside the list may compute them — the
 * library's scroll-to-current once did, with its own row heights, and drifted
 * ~11,000px by row 500. The mounted list registers its own `scrollToIndex`;
 * callers go through here.
 */

type ScrollFn = (index: number, align?: "center" | "start") => void;

let handle: ScrollFn | null = null;

/** Called by the mounted list. Returns the unregister function. */
export function registerListScroll(fn: ScrollFn): () => void {
  handle = fn;
  return () => {
    if (handle === fn) handle = null;
  };
}

/** Scroll the list to row `index`. False when no list is mounted. */
export function scrollListToRow(index: number, align: "center" | "start" = "center"): boolean {
  if (!handle) return false;
  handle(index, align);
  return true;
}
