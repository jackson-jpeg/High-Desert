/**
 * The holiday seasons (docs/seasons.md): which one a date falls in, for the
 * site's theming and the station's fan favorites. Pure, and dates are plain
 * calendar dates: the site asks with the visitor's own date, the station with
 * the Pacific station day.
 *
 *   - halloween:    15 October to 1 November;
 *   - thanksgiving: the 10 days before Thanksgiving (the fourth Thursday of
 *                   November) and the day itself;
 *   - winter:       Christmas and winter, from the day after Thanksgiving to
 *                   6 January (Twelfth Night).
 */

export type Season = "halloween" | "thanksgiving" | "winter";
export const SEASONS: readonly Season[] = ["halloween", "thanksgiving", "winter"];

/**
 * The season on a calendar date (`month` 1–12), or null. Self-contained on
 * purpose: SEASON_SCRIPT inlines its source into the page head, so it must
 * not call anything outside itself.
 */
export function seasonOn(year: number, month: number, day: number): Season | null {
  // Thanksgiving: the fourth Thursday of November.
  const firstWeekday = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const thanksgiving = 1 + ((4 - firstWeekday + 7) % 7) + 21;
  if ((month === 10 && day >= 15) || (month === 11 && day <= 1)) return "halloween";
  if (month === 11 && day >= thanksgiving - 10 && day <= thanksgiving) return "thanksgiving";
  if ((month === 11 && day > thanksgiving) || month === 12 || (month === 1 && day <= 6)) return "winter";
  return null;
}

/** The fourth Thursday of November, as a day of the month. */
export function thanksgivingDay(year: number): number {
  const firstWeekday = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return 1 + ((4 - firstWeekday + 7) % 7) + 21;
}

/** The season on a Pacific station day ("2026-10-31"). */
export function seasonOfDay(isoDay: string): Season | null {
  const [y, m, d] = isoDay.split("-").map(Number);
  return seasonOn(y, m, d);
}

/**
 * A show that belongs to a season by its title: Ghost to Ghost and Halloween
 * shows, Thanksgiving, Christmas and New Year's. The station airs one as a
 * fan favorite only in its season (it still airs on its own date).
 */
export function showSeason(title: string | null | undefined): Season | null {
  if (!title) return null;
  if (/ghost to ghost|halloween/i.test(title)) return "halloween";
  if (/thanksgiving/i.test(title)) return "thanksgiving";
  if (/christmas|new year|millennium/i.test(title)) return "winter";
  return null;
}

/**
 * The page head's script: `<html data-season>` from the visitor's own date,
 * before first paint, so the theme never flashes in after the app loads.
 * `?season=halloween|thanksgiving|winter|off` previews one (or none) on any
 * page, for a look at the next season before it comes.
 */
export const SEASON_SCRIPT = `(function(){try{var q=/[?&]season=([a-z]+)/.exec(location.search),s;if(q){s=q[1]}else{var n=new Date();s=(${seasonOn.toString()})(n.getFullYear(),n.getMonth()+1,n.getDate())}if(${JSON.stringify(SEASONS)}.indexOf(s)>=0)document.documentElement.setAttribute("data-season",s)}catch(e){}})();`;

/** The season `<html data-season>` names, or null (also on the server). */
export function readSeason(doc: Document | null = typeof document === "undefined" ? null : document): Season | null {
  const v = doc?.documentElement.getAttribute("data-season");
  return (SEASONS as readonly string[]).includes(v ?? "") ? (v as Season) : null;
}
