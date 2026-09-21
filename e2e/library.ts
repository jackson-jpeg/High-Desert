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
import { expect, busEventName, type Locator, type Page } from "./fixtures";

/** The library's sort modes, exactly as `?sort=` accepts them (filter-episodes.ts `SORT_MODES`). */
export type SortMode = "date" | "date-asc" | "name" | "guest" | "recent" | "progress" | "rated" | "played";

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
  // The boot screen (#app-loading, src/app/layout.tsx) has a 2.8s floor on a
  // first visit — every test is one — and until it is display:none it sits
  // over the page and swallows the first pointer press, even while fading.
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 10_000 });
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
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 10_000 });
  await waitForListSettled(page);
}

/**
 * Filter the library to one series, as the series badges do: they emit the
 * bus event `filter-series`, dispatched here by its transport name (from
 * src/lib/events.ts, via e2e/fixtures.ts) because this runs in the browser,
 * outside the bundle. A series is sorted by part number, then air
 * date ascending, whatever the sort mode. Pass `null` to clear.
 */
export async function filterSeries(page: Page, series: string | null): Promise<void> {
  await page.evaluate(
    ([name, s]) => window.dispatchEvent(new CustomEvent(name as string, { detail: s })),
    [busEventName("filter-series"), series] as const,
  );
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

/** How a row is assigned to a rail group, read from its `aria-label`. */
export type RowGrouping = "year" | "title-initial";

/**
 * Group key of a row's `aria-label`. Mirrors the rail's *definitions* (air
 * year; a title's initial, accents folded, non-letters as "#") — not its code —
 * so a rail that disagreed with the rows would be caught, not reproduced.
 */
export function groupOfLabel(label: string, grouping: RowGrouping): string {
  if (grouping === "year") return ROW_YEAR.exec(label)?.[1] ?? "Unknown";
  const title = label.replace(ROW_YEAR, "");
  const ch = title.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /\p{L}/u.test(ch) ? ch : "#";
}

/**
 * The list's group order, top to bottom: walk the whole list a screen at a
 * time and collapse consecutive rows of the same group into one entry.
 * Rows with no date read as "Unknown". Leaves the list scrolled to the top.
 */
export async function listGroupRuns(page: Page, grouping: RowGrouping = "year"): Promise<string[]> {
  const labels = await listScroller(page).evaluate(async (sc) => {
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
        byIndex.set(idx, o.getAttribute("aria-label") ?? "");
      }
      if (top + sc.clientHeight >= sc.scrollHeight) break;
    }
    sc.scrollTop = 0;
    await frame();
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
  });
  const runs: string[] = [];
  for (const label of labels) {
    const g = groupOfLabel(label, grouping);
    if (runs[runs.length - 1] !== g) runs.push(g);
  }
  return runs;
}

/** Year runs of the list, top to bottom (see `listGroupRuns`). */
export function listYearRuns(page: Page): Promise<string[]> {
  return listGroupRuns(page, "year");
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

/** Group key of the row at `index` (it must be rendered — in view or in the overscan). */
export async function rowGroupAt(page: Page, index: number, grouping: RowGrouping = "year"): Promise<string | null> {
  const label = await listScroller(page).evaluate((sc, idx) => {
    const lb = sc.querySelector('[role="listbox"]') as HTMLElement;
    const slotH = parseFloat((lb.firstElementChild as HTMLElement | null)?.style.height ?? "0");
    for (const o of lb.querySelectorAll('[role="option"]')) {
      if (Math.round(parseFloat((o.parentElement as HTMLElement).style.top) / slotH) === idx) {
        return o.getAttribute("aria-label") ?? "";
      }
    }
    return null;
  }, index);
  return label === null ? null : groupOfLabel(label, grouping);
}

/** The list's scroll position and row height, and the index of the first row in view. */
export async function listPosition(page: Page): Promise<{ scrollTop: number; rowHeight: number; firstIndex: number }> {
  return listScroller(page).evaluate((sc) => {
    const lb = sc.querySelector('[role="listbox"]') as HTMLElement;
    const rowHeight = parseFloat((lb.firstElementChild as HTMLElement | null)?.style.height ?? "0");
    return { scrollTop: sc.scrollTop, rowHeight, firstIndex: Math.floor(sc.scrollTop / rowHeight) };
  });
}

/**
 * The rail: on desktop the column beside the list (`year-rail`), on a phone
 * the scrubber down the right edge (`year-scrubber`), which is only on screen
 * while the list scrolls. Both mark entries with `data-group` (and `data-year`
 * for years) and the active one with `aria-current="true"`.
 */
export function railEntries(page: Page): Locator {
  return page.locator('[data-testid="year-rail"] [data-group], [data-testid="year-scrubber"] [data-group]');
}

/** The mobile scrubber's root element. */
export function scrubber(page: Page): Locator {
  return page.getByTestId("year-scrubber");
}

/**
 * Scroll the list by a pixel and back, as a listener's thumb would — the
 * mobile scrubber only appears while the list moves. Harmless on desktop.
 */
export async function nudgeList(page: Page): Promise<void> {
  await listScroller(page).evaluate(async (el) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const at = el.scrollTop;
    el.scrollTop = at + 1;
    await frame();
    el.scrollTop = at;
    await frame();
  });
}

/** Rail group keys, top to bottom. Empty when there is no rail in the DOM. */
export async function railGroups(page: Page): Promise<string[]> {
  return railEntries(page).evaluateAll((els) =>
    els
      .map((el) => ({ top: el.getBoundingClientRect().top, key: el.getAttribute("data-group") ?? "" }))
      .sort((a, b) => a.top - b.top)
      .map((e) => e.key),
  );
}

/** Rail labels top to bottom, as 4-digit years (entries that are not years are skipped). */
export async function railYears(page: Page): Promise<string[]> {
  return railEntries(page).evaluateAll((els) =>
    els
      .filter((el) => el.hasAttribute("data-year"))
      .map((el) => ({ top: el.getBoundingClientRect().top, year: el.getAttribute("data-year")! }))
      .sort((a, b) => a.top - b.top)
      .map((e) => e.year),
  );
}

/** Whether the rail is actually on screen (the scrubber is `visibility: hidden` while idle). */
export async function railIsVisible(page: Page): Promise<boolean> {
  const count = await railEntries(page).count();
  return count > 0 && (await railEntries(page).first().isVisible());
}

/** The active rail entry's group and its on-screen y (px), or null if none is active. */
export async function railActive(page: Page): Promise<{ group: string; y: number } | null> {
  return railEntries(page).evaluateAll((els) => {
    const active = els.find((el) => el.getAttribute("aria-current") === "true");
    if (!active) return null;
    return { group: active.getAttribute("data-group") ?? "", y: Math.round(active.getBoundingClientRect().top) };
  });
}
