/**
 * The Library's first order for a new visitor (docs/NEXT.md, round 2, item 2;
 * docs/funnel.md, "The Library's first order").
 *
 * Newest first opens a new visitor's Library on December 2015's Midnight in
 * the Desert specials, which almost nobody came for. So a browser that has
 * never chosen a sort and has never listened to anything opens on what
 * everyone plays: the community "Most played" (`played`). It is not stored:
 * the moment the visitor picks a sort, that one is remembered as before, and
 * once this browser has a listening history, a Library with no stored sort
 * opens newest first again.
 *
 * Desktop only: phones are sent to /live on arrival, and are left alone until
 * the phone look split's verdict (2026-12-02, docs/funnel.md).
 */

import type { SortMode } from "./filter-episodes";

/** The sort a new visitor's Library opens on. */
export const NEW_VISITOR_SORT: SortMode = "played";

export interface FirstSortInputs {
  /** The visitor's remembered sort, already validated; null when none is stored. */
  stored: SortMode | null;
  /** This browser has any saved position or history entry. */
  hasHistory: boolean;
  /** At least the app's desktop width (768 px), read when the Library mounts. */
  isDesktop: boolean;
}

/** The sort to open on, or null to keep the render's default ("date"). Pure. */
export function firstSort(i: FirstSortInputs): SortMode | null {
  if (i.stored) return i.stored;
  if (!i.hasHistory && i.isDesktop) return NEW_VISITOR_SORT;
  return null;
}
