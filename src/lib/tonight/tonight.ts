import type { ShowCatalog } from "@/lib/shows/catalog";
import { clip, type Show } from "@/lib/shows/describe";
import { notableWhy } from "@/lib/shows/notable";
import { addDays, isDayISO, onThisDateKeys, type DayProgram, type SlotKind } from "@/lib/live/schedule";

/**
 * "Tonight on High Desert" (docs/show-pages.md, "Tonight"): one page per
 * station day, `/tonight/<yyyy-mm-dd>`, with that day's frozen program and
 * every show in the catalog that aired on its month and day. Pure; the page
 * reads the program through src/services/live/tonight.ts.
 */

/** The first station day there can be a page for: before it the station did not exist. */
export const FIRST_TONIGHT_DAY = "2026-09-01";
/** How many days, today included, the sitemap lists. Every one is a frozen day once today is. */
/**
 * The first day in `live_days`: when the station first froze a day it froze
 * the 14 before it as its history, so every day from here has a program and a
 * page (2026-09-10 is a 404). Frozen days are never deleted, so this never
 * moves. The sitemap lists every day from it (2026-10-15: it listed only the
 * last 14, which left 21 working pages out).
 */
export const FIRST_STATION_DAY = "2026-09-11";
/** How long a Tonight page is served from cache before it is drawn again. A frozen program never changes. */
export const TONIGHT_REVALIDATE_S = 3600;

export const tonightPath = (day: string) => `/tonight/${day}`;

/**
 * Can `day` have a page at all, on a server whose Pacific today is `today`?
 * A real calendar day from FIRST_TONIGHT_DAY to tomorrow (tomorrow only once
 * its program is frozen, which the page decides).
 */
export function tonightDayInRange(day: string, today: string): boolean {
  if (!isDayISO(day) || addDays(day, 0) !== day) return false;
  return day >= FIRST_TONIGHT_DAY && day <= addDays(today, 1);
}

/** The days the sitemap lists: every station day, today first, back to FIRST_STATION_DAY. */
export function tonightSitemapDays(today: string): string[] {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const d = addDays(today, -i);
    if (d < FIRST_STATION_DAY) break;
    out.push(d);
  }
  return out;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Monday, October 12, 2026". */
export function tonightDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "October 12". */
export function monthDayName(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Every catalog show that aired on this day's month and day, any year, oldest first. */
export function onThisDate(day: string, catalog: ShowCatalog): Show[] {
  const out = onThisDateKeys(day).flatMap((k) => catalog.byMonthDay.get(k) ?? []);
  return [...new Set(out)].sort(
    (a, b) => (a.row.airDate ?? "").localeCompare(b.row.airDate ?? "") || a.slug.localeCompare(b.slug),
  );
}

export interface LineupEntry {
  start: number;
  end: number;
  kind: SlotKind;
  title: string;
  airDate: string | null;
  guestName: string | null;
  /** The show's page, when it has one. */
  show: Show | null;
  /** Why it is worth hearing: the cited reason if it is a notable show, else its summary, clipped. */
  why: string | null;
  /** The Request Line's winner at 10 PM: who asked for it. */
  request?: { by: string; place: string | null; votes: number };
}

/** What each kind of slot is, in a word the page shows. */
export const SLOT_LABELS: Readonly<Record<SlotKind, string>> = {
  "on-this-date": "On this date",
  "fan-favorite": "Listener favorite",
  "outage-swap": "From the mirror",
  "verify-swap": "Listener favorite",
  "breaker-swap": "Listener favorite",
  request: "Listener request",
};

export function whyHear(show: Show | null): string | null {
  if (!show) return null;
  const cited = notableWhy(show.row.fileHash);
  if (cited) return cited;
  const summary = show.row.aiSummary?.trim();
  return summary ? clip(summary, 180) : null;
}

/** The day's program as the page lists it, in air order. */
export function tonightLineup(program: DayProgram, catalog: ShowCatalog): LineupEntry[] {
  return [...program.slots]
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const show = catalog.byHash.get(s.fileHash) ?? null;
      return {
        start: s.start,
        end: s.end,
        kind: s.kind,
        title: s.title,
        airDate: s.airDate,
        guestName: s.guestName,
        show,
        why: whyHear(show),
        ...(s.request ? { request: { by: s.request.by, place: s.request.place, votes: s.request.votes } } : {}),
      };
    });
}

/** The share card's words for a day. */
export function tonightCard(day: string, shows: readonly Show[], lineup: readonly LineupEntry[]): { title: string; subtitle: string } {
  const md = monthDayName(day);
  if (shows.length) {
    const years = shows.map((s) => s.row.airDate?.slice(0, 4)).filter(Boolean) as string[];
    const span = years[0] === years[years.length - 1] ? years[0] : `${years[0]} to ${years[years.length - 1]}`;
    return {
      title: `${shows.length} ${shows.length === 1 ? "broadcast" : "broadcasts"} from ${md}`,
      subtitle: `Aired on this date, ${span}. On the station all day.`,
    };
  }
  return {
    title: `The station on ${md}`,
    subtitle: lineup.length ? `${lineup.length} shows, midnight to midnight Pacific` : "Art Bell around the clock",
  };
}

/** Everything a Tonight page says, from the program (or none) and the catalog. */
export function tonightPage(day: string, program: DayProgram | null, catalog: ShowCatalog) {
  const lineup = program ? tonightLineup(program, catalog) : [];
  const dated = onThisDate(day, catalog);
  const title = `Tonight on High Desert · ${tonightDate(day)}`;
  const md = monthDayName(day);
  const years = dated.map((s) => s.row.airDate?.slice(0, 4)).filter(Boolean) as string[];
  const span = years.length ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]} to ${years[years.length - 1]}`) : "";
  const description = clip(
    `${lineup.length ? `${lineup.length} Art Bell shows on the station, midnight to midnight Pacific` : "Art Bell's radio, all day on the station"}` +
      `${dated.length ? `, and ${dated.length} ${dated.length === 1 ? "broadcast" : "broadcasts"} that aired on ${md}${span ? `, ${span}` : ""}` : ""}. Tune in free.`,
    160,
  );
  // The structured list: the program's shows, then on-this-date shows not on it.
  const seen = new Set<string>();
  const listed: Show[] = [];
  for (const s of [...lineup.map((e) => e.show), ...dated]) {
    if (s && !seen.has(s.slug)) {
      seen.add(s.slug);
      listed.push(s);
    }
  }
  return { lineup, dated, title, description, listed, card: tonightCard(day, dated, lineup) };
}
