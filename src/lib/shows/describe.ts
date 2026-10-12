import { episodeTitle } from "@/lib/library/display-title";
import { shownGuest, shownTopic } from "@/lib/library/guest";
import { slugWords } from "@/lib/shows/slugify";

/**
 * How a show page names its show: the heading, the <title>, the meta
 * description, the series (docs/show-pages.md). Pure; the page, the share
 * image and the structured data all read these, so they cannot disagree.
 */

export const SITE_ORIGIN = "https://highdesert.space";
export const SITE_NAME = "High Desert";

/** A catalog row as `public/seed/library.json` holds it. */
export interface CatalogRow {
  fileHash: string;
  fileName: string;
  title?: string;
  airDate?: string;
  guestName?: string;
  showType?: "coast" | "dreamland" | "special" | "unknown";
  topic?: string;
  duration?: number;
  fileSize?: number;
  sourceUrl?: string;
  archiveIdentifier?: string;
  aiSummary?: string;
  aiTags?: string[];
  aiCategory?: string;
  aiSeries?: string;
  aiSeriesPart?: number;
}

export interface Show {
  slug: string;
  row: CatalogRow;
}

export type SeriesKey = "coast" | "dreamland" | "midnight" | "special";

export interface Series {
  key: SeriesKey;
  /** The programme's full name, as structured data names the PodcastSeries. */
  name: string;
  /** What the title and the page's meta line call it. */
  short: string;
}

export const SERIES: Readonly<Record<SeriesKey, Series>> = {
  coast: { key: "coast", name: "Coast to Coast AM with Art Bell", short: "Coast to Coast AM" },
  dreamland: { key: "dreamland", name: "Dreamland with Art Bell", short: "Dreamland" },
  midnight: { key: "midnight", name: "Midnight in the Desert with Art Bell", short: "Midnight in the Desert" },
  special: { key: "special", name: "Art Bell Specials", short: "Art Bell Special" },
};

const SERIES_PREFIX = /^(Coast to Coast AM|Dreamland|Midnight in the Desert|Special)\s+-\s+/i;

/**
 * The programme a show belongs to. The title's own prefix decides
 * ("Midnight in the Desert - ..." is filed as a special in the catalog, and
 * one Coast to Coast AM broadcast too); the show type is the fallback.
 */
export function seriesOf(row: Pick<CatalogRow, "title" | "showType">): Series {
  const prefix = SERIES_PREFIX.exec(row.title ?? "")?.[1]?.toLowerCase();
  if (prefix === "coast to coast am") return SERIES.coast;
  if (prefix === "dreamland") return SERIES.dreamland;
  if (prefix === "midnight in the desert") return SERIES.midnight;
  if (row.showType === "coast") return SERIES.coast;
  if (row.showType === "dreamland") return SERIES.dreamland;
  return SERIES.special;
}

/** What the show was about: its title without the programme's name. */
export function showSubject(row: Pick<CatalogRow, "title" | "fileName">): string {
  const title = episodeTitle(row);
  return title.replace(SERIES_PREFIX, "").trim() || title;
}

/** The guest as the page prints it, unless the subject already names them. */
export function headlineGuest(row: CatalogRow): string | undefined {
  const guest = shownGuest(row);
  if (!guest) return undefined;
  const subject = new Set(slugWords(showSubject(row)));
  return slugWords(guest).every((w) => subject.has(w)) ? undefined : guest;
}

export { shownGuest, shownTopic };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "1992-12-12" as "December 12, 1992"; anything else as it is. */
export function longDate(airDate: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(airDate ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return airDate ?? "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** "12-12" from "1992-12-12": the day of the year a show aired. */
export function monthDay(airDate: string | undefined): string | null {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(airDate ?? "");
  return m ? m[1] : null;
}

/** ISO 8601 duration, whole seconds: 7798.39 is "PT2H9M58S". */
export function isoDuration(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

/** "2 h 10 min", "48 min". */
export function readableDuration(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${Math.max(1, m)} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * The page's title, before the site template adds "| High Desert":
 * "Area 51 with John Lear and Bob Lazar · Coast to Coast AM, December 12, 1992".
 */
export function showPageTitle(row: CatalogRow): string {
  const guest = headlineGuest(row);
  const date = longDate(row.airDate);
  return `${showSubject(row)}${guest ? ` with ${guest}` : ""} · ${seriesOf(row).short}${date ? `, ${date}` : ""}`;
}

/** The longest meta description worth sending; Google shows about this much. */
export const DESCRIPTION_MAX = 160;

/** `text` cut at a word boundary to at most `max` characters, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/**
 * The meta description: programme and date first (what a search for a date
 * or a guest matches on), then the summary, else the guest and topic.
 */
export function showDescription(row: CatalogRow): string {
  const series = seriesOf(row);
  const date = longDate(row.airDate);
  const lead = `${series.name}${date ? `, ${date}` : ""}.`;
  const summary = row.aiSummary?.trim();
  if (summary) return clip(`${lead} ${summary}`, DESCRIPTION_MAX);
  const guest = shownGuest(row);
  const topic = shownTopic(row);
  const rest = [guest && `With ${guest}.`, topic && `${topic}.`, "Listen to the full broadcast free on High Desert."]
    .filter(Boolean)
    .join(" ");
  return clip(`${lead} ${rest}`, DESCRIPTION_MAX);
}

export const showPath = (slug: string) => `/show/${slug}`;
export const guestPath = (slug: string) => `/guest/${slug}`;
export const absolute = (p: string) => `${SITE_ORIGIN}${p}`;
