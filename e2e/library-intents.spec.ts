/**
 * Library intents from other pages (HD-013).
 *
 * "Shuffle Coast", sort, search and "now playing" were window events that
 * only the library page listened for; fired on /stats they went nowhere, or
 * relied on a setTimeout racing the library's mount. They are URL intents now
 * (/library?shuffle=coast …). These specs drive the real UI paths from /stats
 * and check the outcome a listener would notice — what is queued, what the
 * list shows, and that the address bar is clean afterwards.
 *
 * Also: `/` and Ctrl/Cmd+F belong to the browser everywhere except /library.
 */
import { test, expect, type Page } from "@playwright/test";
import { openLibrary, episodeList, renderedRowCount, waitForListSettled } from "./library";

/** Wait until the desktop layout has hydrated (its wrapper carries `data-hydrated`). */
async function hydrated(page: Page): Promise<void> {
  await expect(page.locator("[data-hydrated]").first()).toBeAttached({ timeout: 30_000 });
}

/**
 * The persisted play queue, as show types. The layout writes the queue's ids
 * to `userPrefs["queue-ids"]` on every change; this reads them back and looks
 * each episode up in the same IndexedDB — the state a shuffle actually
 * produced, not a re-derivation of what it should have been.
 */
async function queuedShowTypes(page: Page): Promise<(string | undefined)[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("HighDesertDB");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const get = <T,>(store: string, key: IDBValidKey, index?: string) =>
      new Promise<T | undefined>((resolve) => {
        const s = db.transaction(store).objectStore(store);
        const req = index ? s.index(index).get(key) : s.get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => resolve(undefined);
      });
    try {
      const pref = await get<{ value: string }>("userPrefs", "queue-ids", "key");
      const ids = JSON.parse(pref?.value ?? "[]") as number[];
      const types: (string | undefined)[] = [];
      for (const id of ids) types.push((await get<{ showType?: string }>("episodes", id))?.showType);
      return types;
    } finally {
      db.close();
    }
  });
}

/** Record `defaultPrevented` for keydowns, from a window listener added after the app's. */
async function watchKeydowns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __hdKeys: { key: string; prevented: boolean }[] };
    w.__hdKeys = [];
    window.addEventListener("keydown", (e) => w.__hdKeys.push({ key: e.key, prevented: e.defaultPrevented }));
  });
}

function keydowns(page: Page): Promise<{ key: string; prevented: boolean }[]> {
  return page.evaluate(() => (window as unknown as { __hdKeys: { key: string; prevented: boolean }[] }).__hdKeys);
}

test("Shuffle Coast to Coast from /stats, via the command palette, lands on a shuffled /library", async ({ page }) => {
  await openLibrary(page); // seeds this profile's catalog
  expect(await queuedShowTypes(page)).toEqual([]);

  await page.goto("/stats");
  await hydrated(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("Search episodes, pages, and actions")).toBeVisible();
  await page.getByRole("button", { name: "Shuffle Coast to Coast" }).click();

  // On the library, with the intent consumed and cleared from the address bar.
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("status").filter({ hasText: /Shuffling \d+ episodes from Coast to Coast/ })).toBeVisible();

  // Shuffle queues a random batch from the chosen show and starts the first.
  // Every queued episode is Coast to Coast, and there is a batch of them.
  await expect.poll(async () => (await queuedShowTypes(page)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(20);
  const types = await queuedShowTypes(page);
  expect(new Set(types)).toEqual(new Set(["coast"]));
});

test("an invalid intent is cleared and does nothing", async ({ page }) => {
  await openLibrary(page);
  await page.goto("/library?shuffle=everything&sort=newest");
  await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await page.waitForTimeout(1_000);
  expect(await queuedShowTypes(page)).toEqual([]);
});

test("?sort= applies the sort and is cleared", async ({ page }) => {
  const { rowCount } = await openLibrary(page);
  await page.goto("/library?sort=name");
  await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await waitForListSettled(page);
  expect(await renderedRowCount(page)).toBe(rowCount);
  const titles = await episodeList(page)
    .locator('[role="option"]')
    .evaluateAll((els) =>
      els
        .map((el) => ({ top: parseFloat((el.parentElement as HTMLElement).style.top), label: el.getAttribute("aria-label") ?? "" }))
        .sort((a, b) => a.top - b.top)
        .slice(0, 8)
        .map((r) => r.label.replace(/, \d{4}-\d\d-\d\d(?: \(now playing\))?$/, "")),
    );
  expect(titles.length).toBeGreaterThan(3);
  const sorted = [...titles].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  expect(titles).toEqual(sorted);
});

test("?q= fills the search box, filters the list and is cleared", async ({ page }) => {
  const { rowCount } = await openLibrary(page);
  await page.goto("/library?q=ghost%20to%20ghost");
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(page.getByPlaceholder(/^Search episodes\.\.\./)).toHaveValue("ghost to ghost");
  await expect.poll(() => renderedRowCount(page), { timeout: 15_000 }).toBeLessThan(rowCount);
  expect(await renderedRowCount(page)).toBeGreaterThan(0);
});

test("Now playing in the status bar, clicked on /stats, finds the show in the library", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "the status bar is desktop chrome");
  await openLibrary(page);
  // Something to be playing: the palette's shuffle, as above.
  await page.keyboard.press("Control+k");
  await page.getByRole("button", { name: "Shuffle Coast to Coast" }).click();
  await expect.poll(async () => (await queuedShowTypes(page)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(20);

  // Client-side to /stats, so the player (and what it is playing) survives.
  await page.locator("nav button", { hasText: "Stats" }).first().click();
  await expect(page).toHaveURL(/\/stats$/);
  const nowPlaying = page.locator("footer button").filter({ hasText: /[▶❚]/ }).first();
  await expect(nowPlaying).toBeVisible();
  await nowPlaying.click();

  await expect(page).toHaveURL(/\/library$/);
  // The playing row is scrolled into view and selected.
  const row = episodeList(page).locator('[role="option"][aria-label$="(now playing)"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toBeInViewport();
});

test("Ctrl+F and / are the browser's on /stats, and the library's on /library", async ({ page }) => {
  await openLibrary(page);

  // Control first: on /library the app does take them — otherwise "not
  // prevented" below would prove nothing about the probe.
  await watchKeydowns(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+f");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("/");
  expect((await keydowns(page)).filter((k) => k.key === "f" || k.key === "/")).toEqual([
    { key: "f", prevented: true },
    { key: "/", prevented: true },
  ]);

  await page.goto("/stats");
  await hydrated(page);
  await watchKeydowns(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+f");
  await page.keyboard.press("/");
  expect((await keydowns(page)).filter((k) => k.key === "f" || k.key === "/")).toEqual([
    { key: "f", prevented: false },
    { key: "/", prevented: false },
  ]);
});
