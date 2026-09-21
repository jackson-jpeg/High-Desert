/**
 * HD-011 in a real browser: a focused button owns Enter, and every delete is
 * confirmed.
 *
 * The unit tests (library-keys, radio-keys) can only show that the page did
 * not `preventDefault()` a key — jsdom performs no default actions. Here the
 * key is pressed in Chromium, so "the button was activated" is the button's
 * visible effect, not an inference.
 *
 * Plays are counted from the play request the library emits on the bus
 * (`play-episode`; its transport name comes from src/lib/events.ts via
 * e2e/fixtures.ts), installed before any app code runs. Each "nothing
 * played" has a control in the same file showing the counter does move.
 */
import { expect, test, busEventName, type Page } from "./fixtures";
import { episodeList, openLibrary } from "./library";

test.skip(({ isMobile }) => isMobile, "keyboard focus on a desktop toolbar; the phone layout has no browse-panel toggle");

async function countPlays(page: Page) {
  await page.addInitScript((name) => {
    (window as unknown as { __plays: number }).__plays = 0;
    window.addEventListener(name, () => {
      (window as unknown as { __plays: number }).__plays++;
    });
  }, busEventName("play-episode"));
}
const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: number }).__plays);

async function selectFirstRow(page: Page) {
  const row = episodeList(page).locator('[role="option"]').first();
  await row.click();
  await expect(page.getByRole("button", { name: "Close detail" })).toBeVisible();
  return row;
}

test("control: Enter on the selected row plays it", async ({ page }) => {
  await countPlays(page);
  await openLibrary(page);
  const row = await selectFirstRow(page);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => plays(page)).toBe(1);
});

test("Enter on a focused toolbar button presses the button and plays nothing", async ({ page }) => {
  await countPlays(page);
  await openLibrary(page);
  await selectFirstRow(page);
  const toggle = page.getByRole("button", { name: "Toggle browse panel" });
  const before = await toggle.getAttribute("title");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).not.toHaveAttribute("title", before ?? "");
  expect(await plays(page)).toBe(0);
});

test("admin Backspace opens the confirmation; Enter on Cancel cancels; Delete deletes that one", async ({ page }) => {
  await countPlays(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("hd-admin", "1"); } catch { /* the test will fail visibly */ }
  });
  await openLibrary(page);
  const row = await selectFirstRow(page);
  const label = await row.getAttribute("aria-label");
  await row.focus();

  await page.keyboard.press("Backspace");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Delete 1 episode?");

  await dialog.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  expect(await plays(page)).toBe(0);
  await expect(episodeList(page).locator(`[role="option"][aria-label="${label}"]`)).toHaveCount(1);

  await row.focus();
  await page.keyboard.press("Backspace");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(episodeList(page).locator(`[role="option"][aria-label="${label}"]`)).toHaveCount(0);
  expect(await plays(page)).toBe(0);
});
