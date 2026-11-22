/**
 * Listeners who chipped in, thanked on /stats (2026-10-09). First name and
 * last initial only: a full name is never written here, so it never reaches
 * the repo or the page. A new supporter goes at the top (the list is newest
 * first); a second gift from someone already here goes into their `gifts`.
 *
 * Tiers (Jackson, 2026-11-22) come from the sum of a person's gifts.
 */
export interface Supporter {
  /** "Rachel B.": a first name and an initial with its period. */
  name: string;
  /** Each gift, whole US dollars. */
  gifts: readonly number[];
}

export const SUPPORTERS: readonly Supporter[] = [
  { name: "Joseph K.", gifts: [50] },
  { name: "Austin M.", gifts: [5] },
  { name: "Alexandra M.", gifts: [15] },
  { name: "Rachel B.", gifts: [10] },
  { name: "Craig A.", gifts: [5] },
];

export type TierId = "owner" | "night-owl" | "regular" | "caller";

export interface Tier {
  id: TierId;
  name: string;
  /** The least total, in whole dollars, that reaches this tier. */
  min: number;
}

/** Highest first. `scripts/donor-shoutout.mjs` keeps a copy, held equal by its test. */
export const TIERS: readonly Tier[] = [
  { id: "owner", name: "Station Owner", min: 50 },
  { id: "night-owl", name: "Night Owl", min: 15 },
  { id: "regular", name: "Regular Caller", min: 10 },
  { id: "caller", name: "Caller", min: 0 },
];

/** Everything this person has given. */
export function totalOf(s: Supporter): number {
  return s.gifts.reduce((sum, g) => sum + g, 0);
}

/** The highest tier the total reaches. */
export function tierOf(s: Supporter): Tier {
  const total = totalOf(s);
  return TIERS.find((t) => total >= t.min) ?? TIERS[TIERS.length - 1];
}

/** People by tier, highest first; inside a tier, the list's own order (newest first). Empty tiers are left out. */
export function groupByTier(supporters: readonly Supporter[]): { tier: Tier; supporters: Supporter[] }[] {
  return TIERS.map((tier) => ({ tier, supporters: supporters.filter((s) => tierOf(s).id === tier.id) })).filter(
    (g) => g.supporters.length > 0,
  );
}

/** "Station Owner, $50 or more. Night Owl, $15 or more. Regular Caller, $10 or more. Caller, any amount." */
export function tierLine(): string {
  return TIERS.map((t) => `${t.name}, ${t.min > 0 ? `$${t.min} or more` : "any amount"}.`).join(" ");
}

export const VENMO_HANDLE = "sanger";
export const VENMO_URL = `https://venmo.com/u/${VENMO_HANDLE}`;

/** PayPal (2026-11-08): Venmo is US-only, and the listeners are not. */
export const PAYPAL_HANDLE = "JacksonSanger";
export const PAYPAL_URL = `https://www.paypal.me/${PAYPAL_HANDLE}`;
