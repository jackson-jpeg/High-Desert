/**
 * Close spellings for the Library search (docs/library-search.md).
 *
 * The search box is an exact substring match (`filterEpisodes`), so "Lazaar",
 * "Hogland" or "Coast to Cost" found nothing at all. This is the fallback,
 * and only the fallback: it runs when the exact match finds no row, so an
 * exact hit is never outranked or joined by a guess, and every sort stays the
 * sort it says it is.
 *
 * - **Words, not substrings.** A show's words are those of its title, guest,
 *   topic, tags, category and series (lowercased, accents dropped). Not the
 *   description or the file name: a guess matched against a paragraph finds
 *   something for anything.
 * - **Each query word must be met** by some word of the show: the same word,
 *   a word it begins (still typing), or one within `maxEdits` (insert, delete,
 *   substitute or swap two neighbours). Words under 3 letters ("to", "of") are
 *   left out; under 4 letters a word must be exact or a prefix.
 * - **The suggestion is what the results say.** For each word that was not
 *   spelt as found, the candidate carried by the most matching shows (then the
 *   nearest) is the "did you mean". Data decides, so "cost" next to "coast"
 *   reads "coast" because that is what the matching shows say.
 */

import type { Episode } from "@/db/schema";

export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** How many edits a query word may be from a show's word. */
export function maxEdits(word: string): number {
  if (word.length < 4) return 0;
  if (word.length < 8) return 1;
  return 2;
}

/**
 * Optimal string alignment distance (Levenshtein plus a swap of two
 * neighbours), or `limit + 1` as soon as it is certain to exceed `limit`.
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a === b) return 0;
  const n = b.length;
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = new Array(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > limit) return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

const wordCache = new WeakMap<Episode, ReadonlySet<string>>();

/** The words a show can be found by (cached per row object). */
export function episodeWords(ep: Episode): ReadonlySet<string> {
  let set = wordCache.get(ep);
  if (!set) {
    const all = [
      ...words(ep.title),
      ...words(ep.guestName),
      ...words(ep.topic),
      ...words(ep.aiCategory),
      ...words(ep.aiSeries),
      ...(ep.aiTags ?? []).flatMap((t) => words(t)),
    ];
    set = new Set(all);
    wordCache.set(ep, set);
  }
  return set;
}

export interface FuzzyResult {
  /** The shows every query word meets, in input order. */
  episodes: Episode[];
  /** Each query word the results spell differently, and how they spell it. */
  corrections: Array<{ from: string; to: string }>;
}

const NONE: FuzzyResult = { episodes: [], corrections: [] };

/** Close-spelling matches for free text `text` among `list`. */
export function fuzzyTextMatch(list: readonly Episode[], text: string): FuzzyResult {
  const query = [...new Set(words(text).filter((w) => w.length >= 3))];
  if (query.length === 0 || list.length === 0) return NONE;

  // Every distinct word of the list, once, so each query word is compared
  // with a vocabulary of a few thousand rather than with every row.
  const vocab = new Set<string>();
  for (const ep of list) for (const w of episodeWords(ep)) vocab.add(w);

  // For each query word, the vocabulary words that meet it, with the distance.
  const accepted: Array<Map<string, number>> = query.map((q) => {
    const limit = maxEdits(q);
    const meets = new Map<string, number>();
    for (const v of vocab) {
      if (v === q || (v.length > q.length && v.startsWith(q))) {
        meets.set(v, 0);
        continue;
      }
      if (limit === 0) continue;
      const d = editDistance(q, v, limit);
      if (d <= limit) meets.set(v, d);
    }
    return meets;
  });
  if (accepted.some((m) => m.size === 0)) return NONE;

  const episodes = list.filter((ep) => {
    const own = episodeWords(ep);
    return accepted.every((meets) => {
      for (const w of own) if (meets.has(w)) return true;
      return false;
    });
  });
  if (episodes.length === 0) return NONE;

  const corrections: FuzzyResult["corrections"] = [];
  query.forEach((q, i) => {
    const meets = accepted[i];
    const carried = new Map<string, number>();
    for (const ep of episodes) {
      for (const w of episodeWords(ep)) if (meets.has(w)) carried.set(w, (carried.get(w) ?? 0) + 1);
    }
    let best: string | null = null;
    for (const [w, n] of carried) {
      if (
        best === null ||
        n > carried.get(best)! ||
        (n === carried.get(best)! && meets.get(w)! < meets.get(best)!) ||
        (n === carried.get(best)! && meets.get(w)! === meets.get(best)! && w < best)
      ) {
        best = w;
      }
    }
    // A prefix (still typing) is not a misspelling: say nothing about it.
    if (best !== null && best !== q && !best.startsWith(q)) corrections.push({ from: q, to: best });
  });

  return { episodes, corrections };
}

/**
 * The search box's text with each correction applied, operators and the
 * listener's other words left as typed. Null when there is nothing to correct.
 */
export function correctedSearch(search: string, corrections: FuzzyResult["corrections"]): string | null {
  if (corrections.length === 0) return null;
  let out = search;
  for (const { from, to } of corrections) {
    // The typed word, whole, any case. A word typed with accents is not found
    // here (`from` has none) and is left as typed.
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(from)})(?=$|[^\\p{L}\\p{N}])`, "iu");
    out = out.replace(re, (_m, pre: string) => `${pre}${to}`);
  }
  return out === search ? null : out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
