import type { ShowCatalog } from "@/lib/shows/catalog";
import { monthDay, type Show } from "@/lib/shows/describe";
import { guestPeople, personKey } from "@/lib/shows/people";

/**
 * A show page's three lists of other shows (docs/show-pages.md): the same
 * guest, the same day in other years, the same category. Each is bounded, no
 * show appears twice across them, and every entry is a show with a page, so
 * every link resolves (related.test.ts walks the whole catalog for that).
 */

export const RELATED_MAX = { guest: 8, sameDay: 8, category: 6 } as const;

/** Categories too broad to suggest anything by. */
const NO_CATEGORY_LIST = new Set(["Other"]);

export interface RelatedShows {
  /** Other shows with any of this show's guests, oldest first. */
  withGuest: Show[];
  /** Shows that aired on this month and day in other years, oldest first. */
  sameDay: Show[];
  /** The same category, nearest in air date first. */
  category: Show[];
}

const dayNumber = (airDate: string | undefined) => {
  const t = Date.parse(`${airDate ?? ""}T00:00:00Z`);
  return Number.isFinite(t) ? t / 86_400_000 : NaN;
};

export function relatedShows(show: Show, catalog: ShowCatalog): RelatedShows {
  const used = new Set<string>([show.slug]);
  const take = (candidates: Show[], max: number): Show[] => {
    const out: Show[] = [];
    for (const s of candidates) {
      if (out.length >= max) break;
      if (used.has(s.slug)) continue;
      used.add(s.slug);
      out.push(s);
    }
    return out;
  };

  const guestShows = new Set<Show>();
  for (const person of guestPeople(show.row)) {
    for (const s of catalog.byPerson.get(personKey(person)) ?? []) guestShows.add(s);
  }
  const byAir = (a: Show, b: Show) =>
    (a.row.airDate ?? "").localeCompare(b.row.airDate ?? "") || a.slug.localeCompare(b.slug);
  const withGuest = take([...guestShows].sort(byAir), RELATED_MAX.guest);

  const md = monthDay(show.row.airDate);
  const year = show.row.airDate?.slice(0, 4);
  const sameDay = take(
    (md ? catalog.byMonthDay.get(md) ?? [] : []).filter((s) => s.row.airDate?.slice(0, 4) !== year),
    RELATED_MAX.sameDay,
  );

  const cat = show.row.aiCategory;
  const here = dayNumber(show.row.airDate);
  const category =
    cat && !NO_CATEGORY_LIST.has(cat)
      ? take(
          [...(catalog.byCategory.get(cat) ?? [])].sort(
            (a, b) =>
              Math.abs(dayNumber(a.row.airDate) - here) - Math.abs(dayNumber(b.row.airDate) - here) ||
              a.slug.localeCompare(b.slug),
          ),
          RELATED_MAX.category,
        )
      : [];

  return { withGuest, sameDay, category };
}
