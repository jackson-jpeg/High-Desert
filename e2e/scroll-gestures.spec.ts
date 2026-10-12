import { test, expect, type Page } from "./fixtures";
import { openLibrary } from "./library";
import { swipe } from "./touch";

/**
 * Scrolling is never a command (2026-10-12). On iPhone Safari in Win98,
 * scrolling down the Library kept opening Mel's Hole: the library page
 * counted scroll events at the bottom of its list, and iOS's momentum and
 * bounce fire dozens of them on an ordinary scroll. Every easter egg now
 * opens only from a deliberate act (Start, Run..., `melshole`; "hole" typed
 * on a keyboard; a search word; a key chord), never from a gesture.
 *
 * Each main screen is scrolled top to bottom on a phone with touch, pushed
 * past its bottom, scrolled back to the top and pulled past that, in both
 * looks. Anything that opens fails the test: a dialog, a menu, an overlay
 * over the page, a toast (a swipe that queued or favourited a row), or a
 * change of address.
 *
 * Runs in the `mobile` project (Chromium, the browser's own touch scrolling)
 * and, with E2E_WEBKIT=1, the `iphone` project (WebKit, Mobile Safari's
 * engine). See e2e/touch.ts for what each does and does not reproduce.
 */

const LOOKS = ["win98", "night"] as const;
type Look = (typeof LOOKS)[number];

const SCREENS: [name: string, path: string][] = [
  ["welcome", "/"],
  ["library", "/library"],
  ["live", "/live"],
  ["stats", "/stats"],
  ["dial", "/library?view=dial"],
  ["topics", "/topics"],
];

interface Opened {
  url: string;
  dialogs: string[];
  overlays: string[];
  toasts: number;
}

/** What is open right now, as a listener would see it. */
function whatIsOpen(page: Page): Promise<Opened> {
  return page.evaluate(() => {
    const visible = (e: Element) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    const label = (e: Element) =>
      `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[role=${e.getAttribute("role")}]` : ""}${e.getAttribute("data-testid") ? `#${e.getAttribute("data-testid")}` : ""} "${(e.textContent ?? "").trim().slice(0, 60)}"`;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [data-testid="w98-mels-hole"], [data-easter-egg]')]
      .filter(visible)
      .map(label);
    // Anything fixed, stacked high and covering most of the screen: how every
    // egg and sheet draws itself.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overlays = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const s = getComputedStyle(e);
        if (s.position !== "fixed" || !(Number(s.zIndex) >= 100)) return false;
        const r = e.getBoundingClientRect();
        return visible(e) && (r.width * r.height) / (vw * vh) > 0.4;
      })
      .filter((e) => e.id !== "app-loading")
      .map(label);
    const toasts = document.querySelectorAll('[aria-live="polite"] [role="status"]').length;
    return { url: location.pathname + location.search, dialogs, overlays, toasts };
  });
}

/** Nothing new is open: no dialog, menu or overlay, no new toast, the same address. */
async function nothingOpened(page: Page, before: Opened, when: string): Promise<void> {
  const now = await whatIsOpen(page);
  expect(now.url, `${when}: the address changed`).toBe(before.url);
  expect(now.dialogs, `${when}: a dialog or menu opened`).toEqual(before.dialogs);
  expect(now.overlays, `${when}: something covers the screen`).toEqual(before.overlays);
  // Toasts expire on their own; only a new one counts.
  expect(now.toasts, `${when}: a toast appeared (a swipe acted on a row?)`).toBeLessThanOrEqual(before.toasts);
}

async function scrollState(page: Page): Promise<string> {
  // Every scrolled position on the page: the signature stops changing when
  // the screen has reached an end.
  return page.evaluate(() =>
    [document.scrollingElement, ...document.querySelectorAll("*")]
      .filter((e): e is Element => !!e && e.scrollTop > 0)
      .map((e) => Math.round(e.scrollTop))
      .join(","),
  );
}

/** Swipe one way until nothing moves for three swipes, then three more past the end. */
async function scrollToEnd(page: Page, dy: number, max: number): Promise<number> {
  let still = 0;
  let swipes = 0;
  let last = await scrollState(page);
  while (still < 3 && swipes < max) {
    await swipe(page, dy);
    swipes++;
    const now = await scrollState(page);
    still = now === last ? still + 1 : 0;
    last = now;
  }
  for (let i = 0; i < 3; i++) await swipe(page, dy);
  return swipes;
}

async function enterLook(page: Page, baseURL: string, look: Look): Promise<void> {
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
}

for (const look of LOOKS) {
  test.describe(`scrolling is never a command: ${look}`, () => {
    test.beforeEach(async ({ page, baseURL, isMobile }) => {
      test.skip(!isMobile, "a phone's gestures");
      await enterLook(page, baseURL!, look);
    });

    test("the Library, top to bottom and back, opens nothing", async ({ page }) => {
      test.setTimeout(600_000);
      await openLibrary(page);
      await page.waitForTimeout(1_500);
      const before = await whatIsOpen(page);
      const down = await scrollToEnd(page, 2_400, 400);
      expect(down, "the list never moved").toBeGreaterThan(2);
      await nothingOpened(page, before, "after scrolling to the bottom and past it");
      await scrollToEnd(page, -2_400, 400);
      await nothingOpened(page, before, "after scrolling back up and pulling past the top");
    });

    test("every other main screen, top to bottom and back, opens nothing", async ({ page }) => {
      test.setTimeout(240_000);
      // Seed the library once so each screen draws what a listener's does.
      await openLibrary(page);
      for (const [name, path] of SCREENS.filter(([n]) => n !== "library")) {
        await page.goto(path);
        await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
        await page.waitForTimeout(1_500);
        const before = await whatIsOpen(page);
        await scrollToEnd(page, 900, 40);
        await nothingOpened(page, before, `${name}: after scrolling to the bottom and past it`);
        await scrollToEnd(page, -900, 40);
        await nothingOpened(page, before, `${name}: after scrolling back up and pulling past the top`);
      }
    });
  });
}
