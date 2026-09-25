/**
 * The episode list as a listbox, and the palette as a modal, in Chromium
 * (HD-021, HD-022).
 *
 * The unit tests (episode-listbox, modal-focus) run in jsdom, which has no
 * layout and moves no focus on its own. Here the list really scrolls, a click
 * really focuses, and a key really goes wherever focus is — so "the active
 * row stays rendered and on screen" is measured, not modelled.
 *
 * Desktop only: on a phone, selecting a row opens the detail sheet, a modal
 * dialog that takes focus — arrow-key list navigation is a desktop affair.
 */
import { expect, test, type Page } from "./fixtures";
import { episodeList, listScroller, openLibrary } from "./library";

test.skip(({ isMobile }) => isMobile, "keyboard list navigation is desktop; a phone row opens a modal sheet");

/** The row aria-activedescendant names, and whether it is inside the scroller's visible box. */
async function activeRow(page: Page): Promise<{ label: string | null; selected: string | null; onScreen: boolean } | null> {
  return episodeList(page).evaluate((lb) => {
    const id = lb.getAttribute("aria-activedescendant");
    const el = id ? document.getElementById(id) : null;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const view = (lb.parentElement as HTMLElement).getBoundingClientRect();
    return {
      label: el.getAttribute("aria-label"),
      selected: el.getAttribute("aria-selected"),
      onScreen: box.top >= view.top && box.bottom <= view.bottom + 1,
    };
  });
}

test("click a row, then the arrows walk the list; the active row is always rendered and on screen", async ({ page }) => {
  const { rowCount } = await openLibrary(page);
  const list = episodeList(page);
  const first = list.locator('[role="option"]').first();
  // Read now, not at the end: a locator re-resolves, and once the list has
  // been to End and back its first option *in DOM order* is whichever row the
  // virtualiser happened to reuse — not necessarily row 1.
  const firstLabel = await first.getAttribute("aria-label");
  expect(await first.getAttribute("aria-posinset")).toBe("1");
  await first.click();
  // A click on a row focuses the listbox: rows are not tab stops.
  await expect(list).toBeFocused();
  await expect.poll(async () => (await activeRow(page))?.label).toBe(firstLabel);

  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
  const after = await activeRow(page);
  expect(after, "aria-activedescendant must name a rendered row").not.toBeNull();
  expect(after!.onScreen).toBe(true);
  expect(after!.selected).toBe("true");
  expect(await list.locator('[role="option"][aria-selected="true"]').count()).toBe(1);
  const posinset = await page.locator(`#${await list.getAttribute("aria-activedescendant")}`).getAttribute("aria-posinset");
  expect(posinset).toBe("41");

  await page.keyboard.press("End");
  await expect.poll(async () => (await activeRow(page))?.onScreen).toBe(true);
  expect(await page.locator(`#${await list.getAttribute("aria-activedescendant")}`).getAttribute("aria-posinset")).toBe(String(rowCount));
  expect(await listScroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press("Home");
  await expect.poll(async () => (await activeRow(page))?.label).toBe(firstLabel);
  expect(await page.locator(`#${await list.getAttribute("aria-activedescendant")}`).getAttribute("aria-posinset")).toBe("1");
  expect(await listScroller(page).evaluate((el) => el.scrollTop)).toBe(0);
});

test("the list takes focus; ArrowDown with nothing selected selects the first row", async ({ page }) => {
  await openLibrary(page);
  const list = episodeList(page);
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await activeRow(page))?.selected).toBe("true");
  await expect(page.getByRole("button", { name: "Close detail" })).toBeVisible();
});

test("Escape in the command palette closes the palette and nothing behind it", async ({ page }) => {
  await openLibrary(page);
  await episodeList(page).locator('[role="option"]').first().click();
  const close = page.getByRole("button", { name: "Close detail" });
  await expect(close).toBeVisible();

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search episodes, pages, and actions" })).toBeFocused();

  // Tab stays in the palette.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Search episodes, pages, and actions" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  // The library's own Escape closes the detail panel. It must not have run.
  await expect(close).toBeVisible();
  // And focus is back on the list the palette was opened from.
  await expect(episodeList(page)).toBeFocused();
});
