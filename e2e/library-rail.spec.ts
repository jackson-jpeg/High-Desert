/**
 * The library rail must run the same way as the list it navigates.
 *
 * User report: "the scroll direction and the timeline rail on the right run
 * opposite ways". The rail sorted its years ascending on its own while the
 * default list runs newest first, and its active year came from an overscan
 * row five rows above the viewport. Full account, before and after:
 * docs/timeline-rail.md.
 *
 * The rail is now a projection of the rendered list (`deriveRailGroups`). On
 * desktop it is the column beside the list; on a phone it is a scrubber down
 * the right edge that appears while the list scrolls. Every case runs at both
 * sizes (playwright.config.ts projects "desktop" and "mobile").
 */
import { expect, test, type Page } from "./fixtures";
import {
  filterSeries,
  listGroupRuns,
  listPosition,
  nudgeList,
  openLibrary,
  railActive,
  railEntries,
  railGroups,
  railIsVisible,
  rowGroupAt,
  scrollListTo,
  scrubber,
  selectSort,
  type RowGrouping,
} from "./library";

interface Case {
  name: string;
  select: (page: Page) => Promise<void>;
  grouping: RowGrouping;
  /** A list must have at least this many groups for the order test to mean anything. */
  minGroups: number;
  /** Where to scroll to for "the indicator moves down": far enough to leave the first group. */
  scrollTo: number;
}

const CASES: Case[] = [
  {
    name: "date, newest first (default sort)",
    select: (page) => selectSort(page, "date"),
    grouping: "year",
    minGroups: 10,
    scrollTo: 0.5,
  },
  {
    name: "date, oldest first",
    select: (page) => selectSort(page, "date-asc"),
    grouping: "year",
    minGroups: 10,
    scrollTo: 0.5,
  },
  {
    // Ghost to Ghost: 22 episodes over 15 years, 1993 → 2010, in part order.
    // Short enough that the old overscan lag pinned the indicator to row 0.
    name: "series filter (part order)",
    select: (page) => filterSeries(page, "Ghost to Ghost"),
    grouping: "year",
    minGroups: 4,
    scrollTo: 0.5,
  },
  {
    // Non-chronological. Titles begin with the show's name, so on this
    // catalogue the initials are C (Coast to Coast AM, ~1,190 rows), D, S.
    name: "name (title initials)",
    select: (page) => selectSort(page, "name"),
    grouping: "title-initial",
    minGroups: 3,
    scrollTo: 0.93,
  },
];

for (const c of CASES) {
  test.describe(c.name, () => {
    test.beforeEach(async ({ page }) => {
      await openLibrary(page);
      await c.select(page);
    });

    test("rail labels run in the list's group order, top to bottom", async ({ page }) => {
      const runs = await listGroupRuns(page, c.grouping);
      // Guard against a vacuous pass: a one-group list has nothing to order.
      expect(runs.length, "list must span several groups").toBeGreaterThanOrEqual(c.minGroups);
      await nudgeList(page);
      expect(await railIsVisible(page), "rail must be on screen").toBe(true);
      expect(await railGroups(page)).toEqual(runs);
    });

    test("scrolling the list down moves the active indicator down", async ({ page }) => {
      await scrollListTo(page, 0);
      await nudgeList(page);
      expect(await railIsVisible(page), "rail must be on screen").toBe(true);
      const before = await railActive(page);
      expect(before, "an entry must be active at the top of the list").not.toBeNull();
      expect(before!.group).toBe(await rowGroupAt(page, 0, c.grouping));

      await scrollListTo(page, c.scrollTo);
      await expect
        .poll(async () => (await railActive(page))?.y ?? -Infinity, {
          message: `active entry should move below y=${before!.y} (was ${before!.group})`,
          timeout: 3_000,
        })
        .toBeGreaterThan(before!.y);
      // ...and it names the first row actually in view, not an overscan row.
      const { firstIndex } = await listPosition(page);
      expect((await railActive(page))!.group).toBe(await rowGroupAt(page, firstIndex, c.grouping));
    });
  });
}

/** Where the list must land after choosing `group`: its first row at the very top. */
async function expectGroupAtTop(page: Page, group: string) {
  await expect.poll(async () => (await railActive(page))?.group, { timeout: 3_000 }).toBe(group);
  const { scrollTop, rowHeight, firstIndex } = await listPosition(page);
  expect(scrollTop % rowHeight, "a group's first row starts exactly at the top").toBe(0);
  expect(await rowGroupAt(page, firstIndex)).toBe(group);
  if (firstIndex > 0) expect(await rowGroupAt(page, firstIndex - 1), "the row above belongs to the previous group").not.toBe(group);
}

test.describe("desktop rail", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "the column rail is the desktop body"));

  for (const mode of ["date", "date-asc"] as const) {
    test(`${mode}: clicking an entry puts that group's first row at the top`, async ({ page }) => {
      await openLibrary(page);
      await selectSort(page, mode);
      const groups = await railGroups(page);
      const target = groups[Math.floor(groups.length / 2)];
      await railEntries(page).and(page.locator(`[data-group="${target}"]`)).click();
      await expectGroupAtTop(page, target);
    });
  }
});

test.describe("mobile scrubber", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "the scrubber is the phone's body"));

  test("appears while the list scrolls and hides once it is idle", async ({ page }) => {
    await openLibrary(page);
    await expect(scrubber(page)).toBeHidden();
    await scrollListTo(page, 0.2);
    await expect(scrubber(page)).toBeVisible();
    await expect(scrubber(page)).toBeHidden({ timeout: 4_000 });
  });

  for (const mode of ["date", "date-asc"] as const) {
    test(`${mode}: dragging to a label puts that group's first row at the top`, async ({ page }) => {
      await openLibrary(page);
      await selectSort(page, mode);
      await nudgeList(page);
      const groups = await railGroups(page);
      const target = groups[Math.floor(groups.length / 2)];
      const first = await railEntries(page).first().boundingBox();
      const dest = await railEntries(page).and(page.locator(`[data-group="${target}"]`)).boundingBox();
      expect(first && dest, "scrubber labels must be laid out").toBeTruthy();

      await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
      await page.mouse.down();
      await page.mouse.move(dest!.x + dest!.width / 2, dest!.y + dest!.height / 2, { steps: 8 });
      await expect(page.getByTestId("year-scrubber-bubble")).toBeVisible();
      await page.mouse.up();

      await expectGroupAtTop(page, target);
    });
  }
});
