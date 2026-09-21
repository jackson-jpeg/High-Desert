/**
 * The year rail must run the same way as the list it navigates.
 *
 * User report: "the scroll direction and the timeline rail on the right run
 * opposite ways". The rail sorted its years ascending on its own while the
 * default list runs newest first, and its active year came from an overscan
 * row five rows above the viewport. Full account and screenshots:
 * docs/timeline-rail.md.
 *
 * Two date orders exist in the app: the default sort (newest first) and a
 * series filter (part number, then air date ascending). There is no ascending
 * date *sort* to select; if one is added, add it to CASES.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  filterSeries,
  listYearRuns,
  openLibrary,
  railActive,
  railIsVisible,
  railYears,
  scrollListTo,
  selectSort,
} from "./library";

interface Case {
  name: string;
  select: (page: Page) => Promise<void>;
  /** Projects on which each assertion fails on current code. */
  failsOrder: string[];
  failsScroll: string[];
}

const CASES: Case[] = [
  {
    name: "date, newest first (default sort)",
    select: (page) => selectSort(page, "date"),
    // desktop: rail is '92 → '13 beside a list that runs '13 → '92.
    // mobile: the rail is `hidden md:flex` — never shown at 390.
    failsOrder: ["desktop", "mobile"],
    // desktop: the indicator climbs the rail as the list scrolls down.
    failsScroll: ["desktop", "mobile"],
  },
  {
    // Ghost to Ghost: 22 episodes over 15 years, 1993 → 2010.
    name: "date, oldest first (series filter)",
    select: (page) => filterSeries(page, "Ghost to Ghost"),
    // desktop passes: both ascending, by coincidence rather than design.
    failsOrder: ["mobile"],
    // desktop: 22 rows barely scroll, so with 5 rows of overscan the first
    // *rendered* row is always row 0 and the indicator never leaves '93.
    failsScroll: ["desktop", "mobile"],
  },
];

for (const c of CASES) {
  test.describe(c.name, () => {
    test.beforeEach(async ({ page }) => {
      await openLibrary(page);
      await c.select(page);
    });

    test("rail labels run in the list's group order, top to bottom", async ({ page }, info) => {
      // fixed in Step 3 (rail is a projection of the list)
      test.fail(c.failsOrder.includes(info.project.name), "rail order is independent of the list on current code");

      const runs = await listYearRuns(page);
      // Guard against a vacuous pass: a one-year list has nothing to order.
      expect(runs.length, "list must span several years").toBeGreaterThan(3);
      expect(await railIsVisible(page), "rail must be on screen").toBe(true);
      expect(await railYears(page)).toEqual(runs);
    });

    test("scrolling the list down moves the active indicator down", async ({ page }, info) => {
      // fixed in Step 3 (rail is a projection of the list)
      test.fail(c.failsScroll.includes(info.project.name), "indicator moves the wrong way, lags, or is hidden on current code");

      await scrollListTo(page, 0);
      expect(await railIsVisible(page), "rail must be on screen").toBe(true);
      const before = await railActive(page);
      expect(before, "an entry must be active at the top of the list").not.toBeNull();

      await scrollListTo(page, 0.5);
      await expect
        .poll(async () => (await railActive(page))?.y ?? -Infinity, {
          message: `active entry should move below y=${before!.y} (was ${before!.year})`,
          timeout: 3_000,
        })
        .toBeGreaterThan(before!.y);
    });
  });
}
