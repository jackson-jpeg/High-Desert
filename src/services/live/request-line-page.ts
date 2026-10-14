import { pacificDay, requestDayAt } from "@/lib/live/schedule";
import { requestLinePage } from "@/lib/live/request-line-page";
import { showCatalog } from "@/lib/shows/load";
import { loadNominations, loadRequestNight } from "@/services/live/requests";

/**
 * Everything the Request Line page and its card show, read on the server at
 * `now`. Without a database: no nominations, said plainly on the page.
 */
export async function requestLineData(now: number = Date.now()) {
  const day = requestDayAt(now);
  const available = !!process.env.DATABASE_URL;
  let rows: Awaited<ReturnType<typeof loadNominations>> = [];
  let night = null;
  if (available) {
    try {
      [rows, night] = await Promise.all([loadNominations(day), loadRequestNight(pacificDay(now), now)]);
    } catch (err) {
      console.error("[request-line] unavailable:", (err as Error).message);
      return { available: false, now, page: requestLinePage(day, [], null, showCatalog()) };
    }
  }
  return { available, now, page: requestLinePage(day, rows, night, showCatalog()) };
}
