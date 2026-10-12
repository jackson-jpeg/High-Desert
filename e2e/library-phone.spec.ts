import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "./fixtures";
import { openLibrary, episodeList } from "./library";

/**
 * The Library on a phone, first screen (2026-10-12). From the top:
 * Continue listening, the search and filters, then the list, whose first
 * shows must be on screen and uncovered without a scroll. Explore (recently
 * played, On this date) sits under the list, collapsed; the install offer is
 * one slim line. Both looks, a first visit and a returning listener (Continue
 * listening, the install line and the swipe tip all showing: the most the
 * first screen ever has to hold).
 *
 * Screenshots go to test-results/library-phone/ for a person to look at;
 * they are evidence, not pixel baselines (see e2e/looks.spec.ts).
 */

const LOOKS = ["win98", "night"] as const;
type Look = (typeof LOOKS)[number];
const OUT = "test-results/library-phone";
mkdirSync(OUT, { recursive: true });

/** Rows that must be whole, on screen and uncovered on arrival. */
const FIRST_ROWS = 3;

async function enterLook(page: Page, baseURL: string, look: Look): Promise<void> {
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
}

/** A listener on their second day, partway through three shows. */
async function becomeReturning(page: Page): Promise<void> {
  const seed = (await (await page.request.get("/seed/library.json")).json()) as { fileHash: string; duration?: number }[];
  const shows = seed.filter((e) => (e.duration ?? 0) > 3600).slice(0, 3);
  await page.evaluate(async (rows) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open("HighDesertDB");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("progress", "readwrite");
      rows.forEach((r, i) => tx.objectStore("progress").put({ fileHash: r.fileHash, playbackPosition: 1200 + i * 60, lastPlayedAt: Date.now() - i * 3_600_000 }));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const yesterday = new Date(Date.now() - 86_400_000);
    const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    localStorage.setItem("hd-visits", JSON.stringify({ n: 1, day }));
    sessionStorage.removeItem("hd-visit-counted");
  }, shows);
  await page.reload();
  await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("continue-listening").first()).toBeVisible({ timeout: 15_000 });
}

/** How many of the list's rows are whole, on screen, and not under anything. */
function uncoveredRows(page: Page): Promise<{ whole: number; firstTop: number; bottom: number }> {
  return episodeList(page).evaluate((lb) => {
    const rows = [...lb.querySelectorAll<HTMLElement>('[role="option"]')]
      .map((r) => ({ r, box: r.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0)
      .sort((a, b) => a.box.top - b.box.top);
    const scroller = lb.parentElement!.getBoundingClientRect();
    let whole = 0;
    for (const { r, box } of rows) {
      if (box.top < scroller.top - 1 || box.bottom > Math.min(window.innerHeight, scroller.bottom) + 1) continue;
      // Uncovered: what is drawn at the row's top and bottom edges belongs to it.
      const hit = (y: number) => r.contains(document.elementFromPoint(box.left + box.width / 2, y));
      if (hit(box.top + 3) && hit(box.bottom - 3)) whole++;
    }
    return { whole, firstTop: Math.round(rows[0]?.box.top ?? -1), bottom: Math.round(scroller.bottom) };
  });
}

/** The vertical order of the first screen's parts. */
function order(page: Page): Promise<Record<string, number | null>> {
  return page.evaluate(() => {
    const top = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? Math.round(r.top) : null;
    };
    return {
      continue: top('[data-testid="continue-listening"]'),
      install: top('[data-testid="install-prompt"]'),
      search: top('input[placeholder^="Search episodes"]'),
      list: top('[role="listbox"][aria-label="Episodes"]'),
      explore: top('[data-testid="explore-band"]'),
      tip: top('[data-testid="swipe-tip"]'),
    };
  });
}

for (const look of LOOKS) {
  test.describe(`the Library on a phone: ${look}`, () => {
    test.beforeEach(async ({ page, baseURL, isMobile }) => {
      test.skip(!isMobile, "a phone's first screen");
      await enterLook(page, baseURL!, look);
    });

    test("first visit: the first shows are on the first screen, Explore is under the list", async ({ page }, info) => {
      await openLibrary(page);
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-first-visit.png` });
      const rows = await uncoveredRows(page);
      expect(rows.whole, `whole rows on the first screen (first at ${rows.firstTop}px)`).toBeGreaterThanOrEqual(FIRST_ROWS);
      const o = await order(page);
      expect(o.search, "the search box").not.toBeNull();
      expect(o.list!, "the list under the search").toBeGreaterThan(o.search!);
      if (o.explore !== null) expect(o.explore, "Explore under the list").toBeGreaterThan(o.list!);
      if (o.tip !== null) expect(o.tip, "the swipe tip under the list").toBeGreaterThan(o.list!);
      await expect(page.getByTestId("explore-band").getByRole("button")).toHaveAttribute("aria-expanded", "false");
    });

    test("a returning listener: Continue listening first, then search, then the shows, still on the first screen", async ({ page }, info) => {
      await openLibrary(page);
      await becomeReturning(page);
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-returning.png` });
      const o = await order(page);
      expect(o.continue, "Continue listening").not.toBeNull();
      expect(o.search!, "search under Continue listening").toBeGreaterThan(o.continue!);
      expect(o.list!, "the list under the search").toBeGreaterThan(o.search!);
      if (o.install !== null) {
        expect(o.install, "the install line above the search").toBeLessThan(o.search!);
        const h = await page.getByTestId("install-prompt").evaluate((el) => el.getBoundingClientRect().height);
        expect(h, "the install offer is one slim line").toBeLessThanOrEqual(36);
      }
      const rows = await uncoveredRows(page);
      expect(rows.whole, `whole rows on the first screen (first at ${rows.firstTop}px)`).toBeGreaterThanOrEqual(FIRST_ROWS);
    });
  });
}
