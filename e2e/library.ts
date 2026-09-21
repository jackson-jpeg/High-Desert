/**
 * Shared helpers for /library specs.
 *
 * Everything here reads the page the way a listener sees it — rendered rows,
 * the rail's buttons, real scroll positions — and never re-derives the list
 * from IndexedDB or the seed file. A helper that re-sorted the catalog itself
 * would reproduce whatever the page does and agree with it
 * (docs/disconnected-checks.md). The one thing taken from the seed file is its
 * length, as the "seeding has finished" signal.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The library's sort modes, exactly as `?sort=` accepts them (filter-episodes.ts `SortMode`). */
export type SortMode = "date" | "name" | "guest" | "recent" | "progress" | "rated" | "played";

const SEED_URL = "/seed/library.json";

/** `aria-label` of a row is `"<title>, YYYY-MM-DD"`, plus `" (now playing)"` on the current show (EpisodeCard). */
const ROW_YEAR = /, (\d{4})-\d\d-\d\d(?: \(now playing\))?$/;

/** The episode listbox. Rows are `role="option"` inside it. */
export function episodeList(page: Page): Locator {
  return page.locator('[role="listbox"][aria-label="Episodes"]');
}

/** The element that actually scrolls: the listbox's parent (TimelineView). */
export function listScroller(page: Page): Locator {
  return episodeList(page).locator("xpath=..");
}

/**
 * Open /library in a fresh profile and wait until the seeded catalog has
 * rendered: the virtual list's full height must account for every episode in
 * the seed file, not merely the first batch.
 *
 * Also marks the listening milestones as seen. Their dialog is modal and
 * covers the list; a spec that gives the profile listening history would
 * otherwise screenshot and click the dialog instead of the library.
 */
export async function openLibrary(page: Page): Promise<{ rowCount: number }> {
  const seed = await page.request.get(SEED_URL);
  expect(seed.ok(), `${SEED_URL} must be served`).toBe(true);
  const expected = ((await seed.json()) as unknown[]).length;
  expect(expected, "seed catalog must not be empty").toBeGreaterThan(0);

  await page.addInitScript(() => {
    try {
      localStorage.setItem("hd-milestones-seen", "[2,10,100]");
    } catch {
      /* storage blocked: the dialog may appear, the test will say so */
    }
  });
  await page.goto("/library");
  await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => renderedRowCount(page), { timeout: 45_000, message: "seeded list never reached the catalog size" })
    .toBe(expected);
  return { rowCount: expected };
}

/**
 * Total rows in the (virtualised) list: its full height over one row slot.
 * Only a window of rows is in the DOM, so counting `option`s would not do.
 */
export function renderedRowCount(page: Page): Promise<number> {
  return episodeList(page).evaluate((lb) => {
    const slot = lb.firstElementChild as HTMLElement | null;
    const slotH = slot ? parseFloat(slot.style.height) : 0;
    return slotH > 0 ? Math.round(parseFloat((lb as HTMLElement).style.height) / slotH) : 0;
  });
}

/**
 * Select a sort mode through the library's URL intent. Both the desktop View
 * menu and the mobile menu sheet navigate to `/library?sort=<mode>` and
 * nothing else (HD-013), so this is the seam they share — and it keeps specs
 * independent of menu markup that is being refactored. A full load: the
 * catalog is already seeded in this profile, so it only waits for the list to
 * render and for the intent to be applied and cleared from the URL. Other
 * library state (filters, scroll) starts fresh, as it would after a menu pick
 * from another page. Resolves once the list has re-rendered and settled.
 */
export async function selectSort(page: Page, mode: SortMode): Promise<void> {
  await page.goto(`/library?sort=${mode}`);
  await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => new URL(page.url()).search, { message: "the ?sort= intent was never cleared" }).toBe("");
  await waitForListSettled(page);
}

/**
 * Filter the library to one series, as the series badges do: they emit the
 * bus event `filter-series`, whose transport is a window CustomEvent named
 * `hd:filter-series` (src/lib/events.ts) — the name is spelled here because
 * this runs in the browser, outside the bundle. A series is sorted by part number, then air date ascending — the
 * only oldest-first listing the app has, since there is no ascending date sort.
 * Pass `null` to clear.
 */
export async function filterSeries(page: Page, series: string | null): Promise<void> {
  await page.evaluate((s) => window.dispatchEvent(new CustomEvent("hd:filter-series", { detail: s })), series);
  await waitForListSettled(page);
}

/** Wait until the list's size and first rows stop changing (sorts run in a deferred memo). */
export async function waitForListSettled(page: Page): Promise<void> {
  const signature = () =>
    episodeList(page)
      .evaluate((lb) => {
        const first = [...lb.querySelectorAll('[role="option"]')].slice(0, 3).map((o) => o.getAttribute("aria-label"));
        return `${(lb as HTMLElement).style.height}|${first.join("|")}`;
      })
      .catch(() => "absent");
  let last = await signature();
  let stableFor = 0;
  for (let i = 0; i < 40 && stableFor < 3; i++) {
    await page.waitForTimeout(100);
    const now = await signature();
    stableFor = now === last ? stableFor + 1 : 0;
    last = now;
  }
}

/** Scroll the list to a fraction (0..1) of its scroll range and let it re-render. */
export async function scrollListTo(page: Page, fraction: number): Promise<void> {
  await listScroller(page).evaluate(async (el, f) => {
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * f);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, fraction);
}

/**
 * The list's group order, top to bottom: walk the whole list a screen at a
 * time and collapse consecutive rows of the same air year into one entry.
 * Rows with no date read as "Unknown". Leaves the list scrolled to the top.
 */
export async function listYearRuns(page: Page): Promise<string[]> {
  return listScroller(page).evaluate(async (sc, pattern) => {
    const re = new RegExp(pattern);
    const lb = sc.querySelector('[role="listbox"]') as HTMLElement;
    const slotH = parseFloat((lb.firstElementChild as HTMLElement | null)?.style.height ?? "0");
    if (!(slotH > 0)) return [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const byIndex = new Map<number, string>();
    for (let top = 0; ; top += sc.clientHeight) {
      sc.scrollTop = top;
      await frame();
      for (const o of lb.querySelectorAll('[role="option"]')) {
        const idx = Math.round(parseFloat((o.parentElement as HTMLElement).style.top) / slotH);
        byIndex.set(idx, re.exec(o.getAttribute("aria-label") ?? "")?.[1] ?? "Unknown");
      }
      if (top + sc.clientHeight >= sc.scrollHeight) break;
    }
    sc.scrollTop = 0;
    await frame();
    const runs: string[] = [];
    for (const [, year] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
      if (runs[runs.length - 1] !== year) runs.push(year);
    }
    return runs;
  }, ROW_YEAR.source);
}

/** Air year of the first row actually in view (not an overscan row above it). */
export async function firstVisibleRowYear(page: Page): Promise<string | null> {
  return listScroller(page).evaluate((sc, pattern) => {
    const lb = sc.querySelector('[role="listbox"]') as HTMLElement;
    const slotH = parseFloat((lb.firstElementChild as HTMLElement | null)?.style.height ?? "0");
    if (!(slotH > 0)) return null;
    const want = Math.floor(sc.scrollTop / slotH);
    for (const o of lb.querySelectorAll('[role="option"]')) {
      if (Math.round(parseFloat((o.parentElement as HTMLElement).style.top) / slotH) === want) {
        return new RegExp(pattern).exec(o.getAttribute("aria-label") ?? "")?.[1] ?? "Unknown";
      }
    }
    return null;
  }, ROW_YEAR.source);
}

/**
 * The year rail's entries.
 *
 * Today the rail (YearNavigator) has no test hook, so entries are found by
 * their `title="YYYY (N episodes)"` and the active one by its `font-bold`
 * class. A rewritten rail should expose `data-testid="year-rail"`, a
 * `data-year` per entry and `aria-current` on the active one; those are
 * preferred here when present, so the Step 3 rail can adopt them without
 * editing any spec.
 */
export function railEntries(page: Page): Locator {
  const tagged = page.locator('[data-testid="year-rail"] [data-year]');
  const legacy = page.locator('button[title$=" episodes)"]');
  return tagged.or(legacy);
}

/** Rail labels top to bottom, as 4-digit years. Empty when there is no rail in the DOM. */
export async function railYears(page: Page): Promise<string[]> {
  return railEntries(page).evaluateAll((els) => {
    const entries: { top: number; year: string }[] = [];
    for (const el of els) {
      const year = el.getAttribute("data-year") ?? /^(\d{4}) \(/.exec(el.getAttribute("title") ?? "")?.[1];
      if (year) entries.push({ top: el.getBoundingClientRect().top, year });
    }
    // Stable sort: entries hidden with display:none all report top 0 and keep DOM order.
    return entries.sort((a, b) => a.top - b.top).map((e) => e.year);
  });
}

/** Whether the rail is actually on screen (it exists in the DOM at 390 but is `display: none`). */
export async function railIsVisible(page: Page): Promise<boolean> {
  const count = await railEntries(page).count();
  return count > 0 && (await railEntries(page).first().isVisible());
}

/** The active rail entry's year and its on-screen y (px), or null if none is active/visible. */
export async function railActive(page: Page): Promise<{ year: string; y: number } | null> {
  return railEntries(page).evaluateAll((els) => {
    const active =
      els.find((el) => {
        const c = el.getAttribute("aria-current");
        return c !== null && c !== "false";
      }) ?? els.find((el) => el.classList.contains("font-bold"));
    if (!active || (active as HTMLElement).offsetParent === null) return null;
    const year = active.getAttribute("data-year") ?? /^(\d{4}) \(/.exec(active.getAttribute("title") ?? "")?.[1];
    return year ? { year, y: Math.round(active.getBoundingClientRect().top) } : null;
  });
}
