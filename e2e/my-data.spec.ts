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
import { test, expect, type Page } from "./fixtures";
import { episodeList, openLibrary, waitForListSettled } from "./library";

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
 * Open the detail panel on the row at `index`, by keyboard.
 *
 * Deliberately not a click on the row. A row is a virtualised, 34px-tall strip
 * carrying sub-controls that stop propagation — the guest name, the series tag,
 * the favourite star — and clicking it proved to be three different flakes in a
 * row: the centre of a 1440px row lands on the guest column (which opens the
 * Guest Profile and closes the detail panel: see `show-guest` in
 * useLibraryBusListeners), a corner click can land on a row the list recycles
 * between resolving it and dispatching the event, and retrying the click could
 * still leave the panel closing under the next action.
 *
 * Selection follows focus in this listbox (`moveTo` in useLibraryKeyboard sets
 * the selected episode), so Home + ArrowDown lands on an exact row with no
 * geometry involved at all. This is how e2e/listbox.spec.ts drives the same
 * panel, and it does not flake there.
 *
 * The retry is the fourth part of the same lesson. On desktop the panel is a
 * 280px sidebar, so opening or closing it changes the list's width and the
 * virtual list re-measures and re-renders: the listbox element you just focused
 * is replaced, focus falls back to `<body>`, and the keys then arrive outside
 * the list (`inList` in useLibraryKeyboard) and do nothing at all. Every step
 * here is therefore inside one `toPass` — focus, confirm the focus survived,
 * press, confirm the panel — so a re-render mid-sequence is retried rather than
 * silently swallowed. The caller settles the list first.
 *
 * **On a phone the keys cannot work, by design.** There the panel is a modal
 * sheet with a focus trap (`useFocusTrap({ active: isMobile })` in DetailSheet),
 * so the moment Home selects the first row the panel opens, focus moves into
 * the dialog, and every later arrow is owned by that dialog
 * (`isKeyOwnedByTarget`: anything inside a dialog owns the navigation keys) and
 * never reaches the list. Asking for row 2 got row 0's panel, already
 * favourited from the first pick, and the test waited 90s for an "Add to
 * favorites" that was never going to be there. So a phone taps the row, near
 * its top-left corner: the mobile card leads with the date, and the guest name
 * — the one sub-control that swallows a tap — is on its own line below.
 */
async function openDetail(page: Page, index: number, isMobile: boolean): Promise<void> {
  const list = episodeList(page);
  const open = page.getByRole("button", { name: "Close detail" });
  if (isMobile) {
    const row = list.locator('[role="option"]').nth(index);
    await expect(async () => {
      await row.click({ position: { x: 6, y: 6 } });
      await expect(open).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    return;
  }
  await expect(async () => {
    await list.focus();
    await expect(list).toBeFocused({ timeout: 1_000 });
    await page.keyboard.press("Home");
    for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
    await expect(open).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Open a row's detail, favourite it and give it `stars`, then close it. */
async function favouriteAndRate(page: Page, index: number, stars: number, isMobile: boolean): Promise<string> {
  const row = episodeList(page).locator('[role="option"]').nth(index);
  const label = (await row.getAttribute("aria-label"))!;
  await openDetail(page, index, isMobile);
  // Whichever way it was opened, it must be the row that was asked for. Without
  // this the phone run silently worked on row 0 twice and spent 90s waiting for
  // a favourite button that row had already used up.
  await expect(episodeList(page).locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
    "aria-label",
    label,
  );
  await detailFavourite(page, false).click();
  await expect(detailFavourite(page, true)).toBeVisible();
  await page.locator(`button[aria-label="Rate ${stars} stars"]:visible`).click();
  await expect(page.getByText(`${stars}/5`).first()).toBeVisible();
  await page.locator('button[aria-label="Close detail"]:visible').click();
  // Closing the sidebar re-measures the virtual list; let it finish before the
  // next row is opened, or that interaction lands mid-re-render.
  await waitForListSettled(page);
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

  const picks = [await favouriteAndRate(page, 0, 4, isMobile), await favouriteAndRate(page, 2, 2, isMobile)];
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
  // The sort has not changed, so the first pick is still the first row; assert
  // that rather than assume it, or "the panel shows a favourite" could be some
  // other episode's.
  await expect(episodeList(page).locator('[role="option"]').first()).toHaveAttribute("aria-label", picks[0]);
  await openDetail(page, 0, isMobile);
  await expect(detailFavourite(page, true)).toBeVisible();
  await expect(page.getByText("4/5").first()).toBeVisible();
});
