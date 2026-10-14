/**
 * Another tab holds the database (2026-10-13, docs/incident-2026-10-13/handoff.md).
 *
 * The incident's best guess: a tab frozen by Android held a write transaction,
 * and the Library sat on gray rows for good. Here a second tab of the same
 * profile really does that: a raw IndexedDB connection keeps a readwrite
 * transaction over `episodes` alive (issuing a request whenever the last one
 * ends, since a transaction with nothing pending commits). The holder sits on
 * /robots.txt, so no app code runs in it and nothing it does is written to
 * the server.
 *
 * Then the Library is reloaded in the first tab. IndexedDB itself queues its
 * read behind the holder; past DB_WAIT_MS (10 s) the page must say so with
 * Retry, not gray rows. The hold is released, Retry is pressed, and the list
 * must fill. The control: the same reload with nothing held never shows the
 * error.
 */
import { test, expect } from "./fixtures";
import { openLibrary, episodeList } from "./library";

const HOLD = `
  window.__hold = new Promise((resolve, reject) => {
    const req = indexedDB.open("HighDesertDB");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const conn = req.result;
      const tx = conn.transaction(["episodes"], "readwrite");
      const store = tx.objectStore("episodes");
      window.__holding = true;
      window.__released = new Promise((done) => { tx.oncomplete = done; tx.onabort = done; }).then(() => conn.close());
      const spin = () => { if (window.__holding) store.count().onsuccess = spin; };
      spin();
      resolve(true);
    };
  });
`;

test.describe("a second tab holding a write transaction", () => {
  test.setTimeout(150_000);

  test("the Library times out into Retry, and Retry recovers once the hold ends", async ({ page, context }) => {
    await openLibrary(page);

    const holder = await context.newPage();
    await holder.goto("/robots.txt");
    await holder.evaluate(HOLD);
    await holder.evaluate(() => (window as unknown as { __hold: Promise<boolean> }).__hold);

    await page.reload();
    const timeout = page.getByTestId("load-timeout");
    await expect(timeout).toBeVisible({ timeout: 25_000 });
    await expect(timeout).toContainText("Your library is taking too long to load.");
    await expect(episodeList(page).locator('[role="option"]')).toHaveCount(0);

    await holder.evaluate(async () => {
      const w = window as unknown as { __holding: boolean; __released: Promise<void> };
      w.__holding = false;
      await w.__released;
    });
    // The queued read may land by itself the moment the hold ends; press
    // Retry if the error is still up. Either way the list must fill.
    await page.getByTestId("load-timeout-retry").click({ timeout: 2_000 }).catch(() => {});
    await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(timeout).toBeHidden();
  });

  test("control: nothing held, the reload never shows the error", async ({ page }) => {
    await openLibrary(page);
    await page.reload();
    await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(12_000);
    await expect(page.getByTestId("load-timeout")).toHaveCount(0);
  });
});
