import type { ShowCatalog } from "@/lib/shows/catalog";
import type { Show } from "@/lib/shows/describe";

/**
 * The archive by year (docs/show-pages.md, "The archive by year"): `/shows`
 * lists the years, `/shows/<year>` every show that year. Every page in the
 * show pages' frame links `/shows`, so a crawler reaches every show page in
 * two hops from any of them, not only through the sitemap.
 */

export const SHOWS_PATH = "/shows";
export const showsYearPath = (year: string) => `${SHOWS_PATH}/${year}`;

export interface ShowYear {
  /** "1993". */
  year: string;
  /** That year's shows, oldest first (the catalog's order). */
  shows: Show[];
}

const cache = new WeakMap<ShowCatalog, ShowYear[]>();

/**
 * Every year with a show, oldest first. A show without an air date has no
 * year page; it is reached from its guest, topic and the sitemap as before.
 */
export function showYears(catalog: ShowCatalog): ShowYear[] {
  let years = cache.get(catalog);
  if (!years) {
    const by = new Map<string, Show[]>();
    for (const s of catalog.shows) {
      const y = /^(\d{4})-/.exec(s.row.airDate ?? "")?.[1];
      if (!y) continue;
      const list = by.get(y);
      if (list) list.push(s);
      else by.set(y, [s]);
    }
    years = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, shows]) => ({ year, shows }));
    cache.set(catalog, years);
  }
  return years;
}

/** The year page for `year`, with its neighbours for the previous/next links. */
export function showYear(catalog: ShowCatalog, year: string): { year: ShowYear; prev: string | null; next: string | null } | null {
  const years = showYears(catalog);
  const i = years.findIndex((y) => y.year === year);
  if (i < 0) return null;
  return { year: years[i], prev: years[i - 1]?.year ?? null, next: years[i + 1]?.year ?? null };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A year's shows by month, in order, for the year page's headings. */
export function byMonth(shows: readonly Show[]): { month: string; shows: Show[] }[] {
  const out: { month: string; shows: Show[] }[] = [];
  for (const s of shows) {
    const m = Number(s.row.airDate?.slice(5, 7));
    const month = MONTHS[m - 1] ?? "Undated";
    const last = out[out.length - 1];
    if (last && last.month === month) last.shows.push(s);
    else out.push({ month, shows: [s] });
  }
  return out;
}
