/**
 * Show slugs: minting and the add-only rule (docs/show-pages.md).
 *
 * `data/show-slugs.json` maps each catalog row's `fileHash` to the slug of its
 * page, `/show/<slug>`. A slug is minted once and never changes: Google, and
 * anyone who shared a link, holds the URL, and a corrected title must not
 * break it. `assignSlugs` keeps every existing entry exactly as it is, even for
 * a row that has since left the catalog (its slug is retired, never reused),
 * and mints new ones only for rows that have none.
 */

import { slugify, slugWords } from "../../src/lib/shows/slugify.ts";
import { episodeTitle } from "../../src/lib/library/display-title.ts";
import { shownGuest } from "../../src/lib/library/guest.ts";

/** The programme names a catalog title starts with ("Coast to Coast AM - Area 51"). */
const SERIES_PREFIX = /^(?:Coast to Coast AM|Dreamland|Midnight in the Desert|Special)\s+-\s+/i;

/** What the show was about: the title without its programme name. */
export function showSubject(row) {
  const title = episodeTitle(row);
  const subject = title.replace(SERIES_PREFIX, "").trim();
  return subject || title;
}

/** The slug a row would get with nothing in its way: date, subject, guest. */
export function showSlugBase(row) {
  const subject = showSubject(row);
  const guest = shownGuest(row);
  const subjectWords = new Set(slugWords(subject));
  // "Coast to Coast AM - Richard C. Hoagland" with guest Richard C. Hoagland:
  // the name once, not twice.
  const guestNew = guest && !slugWords(guest).every((w) => subjectWords.has(w));
  const words = slugify(guestNew ? `${subject} ${guest}` : subject) || "show";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(row.airDate ?? "") ? row.airDate : "0000-00-00";
  return `${date}-${words}`;
}

/**
 * The map with a slug for every row: existing entries untouched, in their
 * order; new rows appended in catalog order. A collision takes `-2`, `-3`...
 *
 * @param {Record<string, string>} existing fileHash to slug, as committed
 * @param {{fileHash: string}[]} rows the catalog
 * @returns {{map: Record<string, string>, added: string[]}}
 */
export function assignSlugs(existing, rows) {
  const map = { ...existing };
  const taken = new Set(Object.values(existing));
  const added = [];
  for (const row of rows) {
    if (!row.fileHash || map[row.fileHash]) continue;
    const base = showSlugBase(row);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    map[row.fileHash] = slug;
    taken.add(slug);
    added.push(row.fileHash);
  }
  return { map, added };
}

/**
 * Entries of `before` that `after` changed or dropped. Empty is the add-only
 * rule holding.
 *
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 */
export function rewrittenSlugs(before, after) {
  return Object.keys(before).filter((hash) => after[hash] !== before[hash]);
}
