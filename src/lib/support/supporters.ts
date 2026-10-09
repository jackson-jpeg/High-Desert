/**
 * Listeners who chipped in, thanked on /stats (2026-10-09). First name and
 * last initial only: a full name is never written here, so it never reaches
 * the repo or the page. Add a gift at the top; the list renders in this order.
 */
export interface Supporter {
  /** "Rachel B.": a first name and an initial with its period. */
  name: string;
  /** Whole US dollars. */
  amount: number;
}

export const SUPPORTERS: readonly Supporter[] = [
  { name: "Rachel B.", amount: 10 },
  { name: "Craig A.", amount: 5 },
];

export const VENMO_HANDLE = "sanger";
export const VENMO_URL = `https://venmo.com/u/${VENMO_HANDLE}`;
