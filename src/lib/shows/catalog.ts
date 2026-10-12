import { isRemovedFromCatalog } from "@/lib/library/removed-episodes";
import { guestPeople, personKey } from "@/lib/shows/people";
import { guestSlug } from "@/lib/shows/slugify";
import { monthDay, type CatalogRow, type Show } from "@/lib/shows/describe";

/**
 * The shows that get pages, and the indexes the related lists and the guest
 * pages read (docs/show-pages.md). Pure: built from the catalog and the
 * committed slug map, so tests build it from the real files the same way the
 * server does (src/lib/shows/load.ts).
 */

export interface Guest {
  slug: string;
  /** The spelling most of their shows use. */
  name: string;
  /** Their shows, oldest first. */
  shows: Show[];
}

export interface ShowCatalog {
  /** Every show with a page, oldest first (ties by slug). */
  shows: Show[];
  bySlug: ReadonlyMap<string, Show>;
  byHash: ReadonlyMap<string, Show>;
  /** personKey → shows with that guest, oldest first. */
  byPerson: ReadonlyMap<string, Show[]>;
  /** "MM-DD" → shows that aired that day, any year, oldest first. */
  byMonthDay: ReadonlyMap<string, Show[]>;
  /** aiCategory → its shows, oldest first. */
  byCategory: ReadonlyMap<string, Show[]>;
  /** Guests with a page (GUEST_PAGE_MIN shows or more), by slug. */
  guests: ReadonlyMap<string, Guest>;
  /** personKey → the guest page slug, for guests that have one. */
  guestSlugByPerson: ReadonlyMap<string, string>;
}

/** A guest page lists at least this many shows; one show is that show's page. */
export const GUEST_PAGE_MIN = 2;

const byAir = (a: Show, b: Show) =>
  (a.row.airDate ?? "").localeCompare(b.row.airDate ?? "") || a.slug.localeCompare(b.slug);

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Pulled episodes (src/lib/library/removed-episodes.ts) get no page, and a
 * row without a slug gets none either (show-slugs.test.ts fails on one).
 */
export function buildShowCatalog(rows: CatalogRow[], slugs: Readonly<Record<string, string>>): ShowCatalog {
  const shows: Show[] = [];
  for (const row of rows) {
    const slug = slugs[row.fileHash];
    if (!slug || isRemovedFromCatalog(row)) continue;
    shows.push({ slug, row });
  }
  shows.sort(byAir);

  const bySlug = new Map<string, Show>();
  const byHash = new Map<string, Show>();
  const byPerson = new Map<string, Show[]>();
  const byMonthDay = new Map<string, Show[]>();
  const byCategory = new Map<string, Show[]>();
  const spellings = new Map<string, Map<string, number>>();

  for (const show of shows) {
    bySlug.set(show.slug, show);
    byHash.set(show.row.fileHash, show);
    for (const person of guestPeople(show.row)) {
      const key = personKey(person);
      if (!key) continue;
      push(byPerson, key, show);
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(person, (counts.get(person) ?? 0) + 1);
      spellings.set(key, counts);
    }
    const md = monthDay(show.row.airDate);
    if (md) push(byMonthDay, md, show);
    if (show.row.aiCategory) push(byCategory, show.row.aiCategory, show);
  }

  const guests = new Map<string, Guest>();
  const guestSlugByPerson = new Map<string, string>();
  for (const [key, list] of byPerson) {
    // One show twice (a guest named twice in one field) is still one show.
    const unique = [...new Set(list)];
    byPerson.set(key, unique);
    if (unique.length < GUEST_PAGE_MIN) continue;
    const name = [...spellings.get(key)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const slug = guestSlug(name);
    if (!slug || guests.has(slug)) continue;
    guests.set(slug, { slug, name, shows: unique });
    guestSlugByPerson.set(key, slug);
  }

  return { shows, bySlug, byHash, byPerson, byMonthDay, byCategory, guests, guestSlugByPerson };
}
