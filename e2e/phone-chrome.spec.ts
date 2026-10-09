import { test, expect, type Page } from "./fixtures";

/**
 * What a phone draws around a failed show and at the bottom of the screen
 * (2026-10-01, from a WebKit screenshot of /live after a failed start):
 *
 * 1. the "Transmission Interrupted" dialog's body was see-through: it was
 *    `glass-heavy` (72% opaque, relying on a backdrop blur), and the studio's
 *    text read through its message;
 * 2. the dialog and the player's red error banner were on screen at once for
 *    the same failure;
 * 3. the desktop status bar was drawn under the phone's tab bar, both visible
 *    at the bottom. The bar carried `hidden md:flex`, but win98.css is
 *    unlayered, so `.w98-statusbar-dark {display:flex}` beat it.
 *
 * The failed start is made in the page: every episode's audio, at archive.org
 * and at /mirror, is refused, so the watchdog fails over, the mirror fails
 * too, and the dialog is raised. Nothing reaches archive.org or the mirror.
 */

test.skip(({ isMobile }) => !isMobile, "the phone's chrome");

const EPISODE_AUDIO = /(archive\.org\/download\/|\/mirror\/archive(:|%3A))/i;

/** Record, as it happens, whether the banner was ever up while the dialog was. */
async function recordOverlap(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hd: { dialog: boolean; banner: boolean; both: boolean } };
    w.__hd = { dialog: false, banner: false, both: false };
    const look = () => {
      const dialog = !!document.querySelector('[role="alertdialog"]');
      const banner = !!document.querySelector('[data-testid="player-error-banner"]') ||
        /Audio source not supported or unavailable|Network error\. Check your connection\.|Audio decoding failed\.|Playback aborted\./.test(
          document.querySelector('[aria-label="Audio player"]')?.textContent ?? "",
        );
      if (dialog) w.__hd.dialog = true;
      if (banner) w.__hd.banner = true;
      if (dialog && banner) w.__hd.both = true;
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

async function failAStart(page: Page) {
  await page.route(EPISODE_AUDIO, (route) => route.abort());
  await page.goto("/live");
  const listen = page.getByTestId("live-tune-in");
  await expect(listen).toBeInViewport({ timeout: 30_000 });
  await listen.tap();
  await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 60_000 });
}

test("a failed start raises one message: the dialog, never the red banner beside it", async ({ page }) => {
  test.setTimeout(120_000);
  await recordOverlap(page);
  // Keep the player's detached element, to send it WebKit's late error.
  await page.addInitScript(() => {
    const w = window as unknown as { __hdEl: HTMLMediaElement | null };
    w.__hdEl = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.src && /^https?:/.test(this.src) && !/station-(id|quiet)/.test(this.src)) w.__hdEl = this;
      return play.call(this);
    };
  });
  await failAStart(page);
  // WebKit fires one more `error` after the watchdog has given up; Chromium
  // does not. Send it here so the check means the same in both engines.
  const sent = await page.evaluate(() => {
    const el = (window as unknown as { __hdEl: HTMLMediaElement | null }).__hdEl;
    if (!el) return false;
    el.dispatchEvent(new Event("error"));
    return true;
  });
  expect(sent, "the player's element was captured").toBe(true);
  // The banner arrived after the dialog in the screenshot: give it the time it took.
  await page.waitForTimeout(3_000);
  const seen = await page.evaluate(() => (window as unknown as { __hd: object }).__hd);
  expect(seen).toMatchObject({ dialog: true, both: false });
});

test("the failure dialog's body is opaque: nothing behind it reads through", async ({ page }) => {
  test.setTimeout(120_000);
  await failAStart(page);
  const surfaces = await page.getByRole("alertdialog").evaluate((dialog) => {
    // Every box between the dialog's edge and its message, with the alpha of its background.
    const alpha = (el: Element) => {
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
      if (!m) return 0;
      const parts = m[1].split(",").map((s) => Number(s.trim()));
      return parts.length === 4 ? parts[3] : 1;
    };
    const msg = [...dialog.querySelectorAll("div")].find((d) => /isn't coming through|no audio in it/.test(d.textContent ?? ""))!;
    const chain: number[] = [];
    for (let el: Element | null = msg; el && el !== dialog.parentElement; el = el.parentElement) chain.push(alpha(el));
    return { max: Math.max(...chain), chain };
  });
  // Some box behind the message paints a fully opaque background.
  expect(surfaces.max, JSON.stringify(surfaces.chain)).toBe(1);
});

test("one bar at the bottom of a phone: the tab bar, not the desktop status bar under it", async ({ page }) => {
  await page.goto("/library");
  const tabs = page.getByRole("navigation").filter({ has: page.getByRole("button", { name: "Library" }) });
  await expect(tabs).toBeVisible({ timeout: 30_000 });
  const bars = await page.evaluate(() =>
    [...document.querySelectorAll(".w98-statusbar-dark, .w98-statusbar")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return getComputedStyle(el).display !== "none" && r.height > 0 && r.width > 0;
      })
      .map((el) => el.className),
  );
  expect(bars).toEqual([]);
});
