/**
 * Station sponsors (2026-11-09, docs/station-breaks.md): Jackson's own apps,
 * aired as old-radio station breaks and shown on /stats. Not the supporters
 * (src/lib/support/supporters.ts): those are listeners who chipped in.
 *
 * App Store links and prices were looked up on the App Store (iTunes lookup,
 * 2026-11-09); the seller of all three is Jackson. Copy is plain and true to
 * each app's own listing. No em dashes (a test holds it).
 */

export type SponsorId = "sogojet" | "screenreceipts" | "simsunday";

export interface Sponsor {
  id: SponsorId;
  name: string;
  /** The cart number the station's cart machine shows ("Cart 07"). */
  cart: string;
  appStoreUrl: string;
  /** The coupon's line: the App Store's own price. */
  price: string;
  /** The print ad's headline. */
  headline: string;
  /** Two short lines under it. */
  body: string;
}

export const SPONSORS: Record<SponsorId, Sponsor> = {
  sogojet: {
    id: "sogojet",
    name: "SoGoJet",
    cart: "07",
    appStoreUrl: "https://apps.apple.com/us/app/sogojet-flight-finder/id6761575104",
    price: "Free on the App Store",
    headline: "Roswell. Rachel. Point Pleasant.",
    body: "Real fares from your home airport, checked in the last week, to the airport nearest whatever is out there.",
  },
  screenreceipts: {
    id: "screenreceipts",
    name: "Screen Receipts",
    cart: "12",
    appStoreUrl: "https://apps.apple.com/us/app/screen-receipts/id6762238386",
    price: "$0.99 on the App Store",
    headline: "Still up at 3 a.m.?",
    body: "Your screen time, printed like a receipt: every app, every hour, a total at the bottom. Then somebody reads it to you.",
  },
  simsunday: {
    id: "simsunday",
    name: "Sim Sunday",
    cart: "21",
    appStoreUrl: "https://apps.apple.com/us/app/sim-sunday/id6821134536",
    price: "Free on the App Store",
    headline: "It's always Sunday.",
    body: "A whole fantasy football season in twenty minutes, live, with a broadcast calling every touchdown. Bring your Sleeper or ESPN league.",
  },
};

export const SPONSOR_IDS = Object.keys(SPONSORS) as SponsorId[];

export function isSponsorId(s: unknown): s is SponsorId {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(SPONSORS, s);
}

/** The card's sign-off, in both looks and on /stats. */
export const SPONSOR_LINE = "A word from the guy who keeps this station running.";
