/**
 * Export / Import My Data (HD-010) through the real UI, in Chromium.
 *
 * The unit suite proves the merge on fake-indexeddb; what only a browser can
 * show is the rest of the chain: the menu item is there and wired, the Blob +
 * `<a download>` actually produces a file under the app's CSP, the file picker
 * opens from the menu click, the confirm dialog appears, and the favourites
 * and ratings are visibly back in a profile that had lost them.
 *
 * "Clear site data" is done for real: the page leaves the app (so no
 * connection holds the database open), deletes the IndexedDB database and
 * localStorage, and comes back to a first visit that seeds from scratch. A
 * control asserts the favourites really are gone before the import — without
 * it, "they are back" would pass just as well if the wipe had done nothing.
 */
import { readFile } from "node:fs/promises";
import { test, expect, type Page, type Locator } from "./fixtures";
import { episodeList, openLibrary } from "./library";

interface Stored { fileHash: string; title?: string; favoritedAt?: number; rating?: number }

/** The listener's favourites and ratings, read back from this profile's IndexedDB. */
function storedPicks(page: Page): Promise<Stored[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("HighDesertDB");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const all = await new Promise<Stored[]>((resolve, reject) => {
        const req = db.transaction("episodes").objectStore("episodes").getAll();
        req.onsuccess = () => resolve(req.result as Stored[]);
        req.onerror = () => reject(req.error);
      });
      return all
        .filter((e) => e.favoritedAt || e.rating)
        .map((e) => ({ fileHash: e.fileHash, title: e.title, favoritedAt: e.favoritedAt, rating: e.rating }))
        .sort((a, b) => a.fileHash.localeCompare(b.fileHash));
    } finally {
      db.close();
    }
  });
}

/**
 * The detail panel's favourite toggle. Rows carry their own favourite marker
 * with the same title (a hover affordance, a `<span>`), so this is the button.
 */
const detailFavourite = (page: Page, on: boolean) =>
  page.locator(`button[title="${on ? "Remove from favorites" : "Add to favorites"}"]:visible`);

/**
 * Open a row's detail.
 *
 * Not a bare `row.click()`: that lands on the row's centre, and a row carries
 * sub-controls that deliberately swallow the click — the guest name, the series
 * tag and the favourite star, each marked `[data-row-action]`. On a 1440px
 * desktop row the guest column sits under the centre point, so clicking there
 * opened the Guest Profile panel and no detail panel at all, for whichever rows
 * happen to name a guest. The date cell is the leading cell in both the desktop
 * grid and the mobile stack and carries no handler of its own, so a click near
 * the row's top-left corner is the one point that always reaches the row.
 *
 * And not a single click either: the list is virtualised, so opening or closing
 * the panel re-lays the rows out and the node under the pointer can be recycled
 * between the moment Playwright resolves it and the moment the event is
 * dispatched. That click lands on a detached row, raises nothing, and does
 * nothing — the test then waited 90s for a panel that was never going to open.
 * So: click until the panel is actually open, which is the only evidence that
 * the click reached a live row. Re-clicking a row that is already open re-selects
 * the same episode; it does not toggle the panel shut.
 */
async function openDetail(page: Page, row: Locator): Promise<void> {
  await expect(async () => {
    await row.click({ position: { x: 6, y: 6 } });
    await expect(page.locator('button[aria-label="Close detail"]:visible')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Open a row's detail, favourite it and give it `stars`, then close it. */
async function favouriteAndRate(page: Page, index: number, stars: number): Promise<string> {
  const row = episodeList(page).locator('[role="option"]').nth(index);
  const label = (await row.getAttribute("aria-label"))!;
  await openDetail(page, row);
  await detailFavourite(page, false).click();
  await expect(detailFavourite(page, true)).toBeVisible();
  await page.locator(`button[aria-label="Rate ${stars} stars"]:visible`).click();
  await expect(page.getByText(`${stars}/5`).first()).toBeVisible();
  await page.locator('button[aria-label="Close detail"]:visible').click();
  return label;
}

/** Choose a data action from the File menu (desktop) or the More sheet (phone). */
async function chooseDataAction(page: Page, isMobile: boolean, action: "Export" | "Import"): Promise<void> {
  if (isMobile) {
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: `${action} My Data` }).click();
  } else {
    await page.getByRole("menuitem", { name: "File" }).click();
    await page.getByRole("menuitem", { name: `${action} My Data...` }).click();
  }
}

/** Clear this origin's site data the way the browser's "clear site data" would, for the app's stores. */
async function clearSiteData(page: Page): Promise<void> {
  // Off the app, onto a same-origin static file: no page holds the DB open,
  // so the delete cannot be blocked.
  await page.goto("/manifest.json");
  const outcome = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        localStorage.clear();
        const req = indexedDB.deleteDatabase("HighDesertDB");
        req.onsuccess = () => resolve("deleted");
        req.onerror = () => resolve(`error: ${req.error}`);
        req.onblocked = () => resolve("blocked");
      }),
  );
  expect(outcome).toBe("deleted");
}

test("favourites and ratings survive export → cleared site data → import, through the menus", async ({ page, isMobile }) => {
  await openLibrary(page);

  const picks = [await favouriteAndRate(page, 0, 4), await favouriteAndRate(page, 2, 2)];
  const before = await storedPicks(page);
  expect(before).toHaveLength(2);
  expect(before.map((e) => e.rating).sort()).toEqual([2, 4]);
  expect(before.every((e) => e.favoritedAt && e.rating), "each pick is both favourited and rated").toBe(true);

  // 2. Export through the menu, capturing the real download.
  const downloadP = page.waitForEvent("download");
  await chooseDataAction(page, isMobile, "Export");
  const download = await downloadP;
  expect(download.suggestedFilename()).toMatch(/^high-desert-my-data-\d{4}-\d\d-\d\d\.json$/);
  const file = await download.path();
  const exported = JSON.parse(await readFile(file, "utf8"));
  expect(exported.format).toBe("high-desert-user-data");
  expect(exported.episodes.map((e: Stored) => e.fileHash).sort()).toEqual(before.map((e) => e.fileHash));

  // 3. Clear site data; a first visit seeds a library with none of it.
  await clearSiteData(page);
  await openLibrary(page);
  expect(await storedPicks(page), "control: the wipe must actually have removed them").toEqual([]);

  // 4. Import the file through the menu.
  const chooserP = page.waitForEvent("filechooser");
  await chooseDataAction(page, isMobile, "Import");
  await (await chooserP).setFiles(file);
  const dialog = page.getByTestId("import-data-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Favourites")).toBeVisible();
  await expect(dialog.getByText("Ratings")).toBeVisible();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();

  // 5. They are back, on the same episodes — in storage and on screen.
  await expect.poll(() => storedPicks(page)).toEqual(before);
  const first = episodeList(page).getByRole("option", { name: picks[0], exact: true });
  await openDetail(page, first);
  await expect(detailFavourite(page, true)).toBeVisible();
  await expect(page.getByText("4/5").first()).toBeVisible();
});
