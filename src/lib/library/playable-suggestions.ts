import type { Episode } from "@/db/schema";

/**
 * What to offer instead of a show that cannot play during an outage: shows the
 * mirror holds, as close to the one asked for as the catalog allows.
 *
 * Tiers, in order — the same guest, then the same category, then the same
 * year — and within a tier the nearest air date first, so a listener who
 * wanted a 1997 Hale-Bopp night is offered 1997 Hale-Bopp nights. If the tiers
 * run short, the nearest-dated shows the mirror holds fill the rest, marked as
 * such: a dialog that offers nothing leaves the listener exactly where the old
 * 15 s error did.
 */

export type SuggestionReason = "guest" | "category" | "year" | "nearby";

export interface Suggestion {
  episode: Episode;
  reason: SuggestionReason;
}

export const REASON_LABEL: Record<SuggestionReason, string> = {
  guest: "Same guest",
  category: "Same category",
  year: "Same year",
  nearby: "Also on the mirror",
};

function dayOf(ep: Pick<Episode, "airDate">): number {
  const t = ep.airDate ? Date.parse(ep.airDate) : NaN;
  return Number.isFinite(t) ? t / 86_400_000 : Number.POSITIVE_INFINITY;
}

export function suggestPlayable(
  target: Episode,
  episodes: readonly Episode[],
  playable: ReadonlySet<string>,
  n = 3,
): Suggestion[] {
  const targetDay = dayOf(target);
  const distance = (ep: Episode) => {
    const d = Math.abs(dayOf(ep) - targetDay);
    return Number.isFinite(d) ? d : Number.MAX_SAFE_INTEGER;
  };
  const candidates = episodes
    .filter((ep) => ep.fileHash !== target.fileHash && playable.has(ep.fileHash))
    // Nearest first; the file hash breaks ties so the order never depends on input order.
    .sort((a, b) => distance(a) - distance(b) || (a.fileHash < b.fileHash ? -1 : 1));

  const year = target.airDate?.slice(0, 4);
  const tiers: [SuggestionReason, (ep: Episode) => boolean][] = [
    ["guest", (ep) => !!target.guestName && ep.guestName === target.guestName],
    ["category", (ep) => !!target.aiCategory && ep.aiCategory === target.aiCategory],
    ["year", (ep) => !!year && ep.airDate?.slice(0, 4) === year],
    ["nearby", () => true],
  ];

  const out: Suggestion[] = [];
  const taken = new Set<string>();
  for (const [reason, matches] of tiers) {
    for (const ep of candidates) {
      if (out.length >= n) return out;
      if (taken.has(ep.fileHash) || !matches(ep)) continue;
      taken.add(ep.fileHash);
      out.push({ episode: ep, reason });
    }
  }
  return out;
}
