import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, answerServerWrites, anotherClientAddress } from "./fixtures";

/**
 * Two listeners tuned in to the live station hear the same second.
 *
 * Two browser contexts — two profiles, two clients — open /live and press
 * Tune in, the second a few seconds after the first (a late joiner). Each
 * player's element is a detached `new Audio()` that is never in the DOM, so it
 * is caught the way e2e/chaos-mirror.spec.ts catches it: by wrapping
 * `HTMLMediaElement.prototype.play` before the app loads and keeping the first
 * element that plays a real source.
 *
 * "The same second" is compared on one clock: both contexts run on this
 * machine, so `currentTime − Date.now()/1000`, read in each page, is the
 * station position each is at, expressed against a clock they share. The
 * mandate is within 2 s (the drift limit); the late joiner must also have
 * landed mid-show, not at 0.
 *
 * Run it against a local build with the e2e database, never production and
 * never TEST_DATABASE_URL (the schedule is frozen into `live_days` on first
 * read, and this would freeze one into whatever database the server uses):
 *
 *   set -a; . /root/.high-desert-e2e.env; set +a
 *   psql "$E2E_DATABASE_URL" -f scripts/schema.sql     # live_days, active_sessions.live_at
 *   DATABASE_URL="$E2E_DATABASE_URL" npx next start -H 127.0.0.1 -p 3013 &
 *   E2E_BASE_URL=http://127.0.0.1:3013 npx playwright test e2e/live.spec.ts
 *
 * It streams the scheduled show from archive.org, so it needs archive.org
 * reachable from the machine running it; when it is not, the spec skips and
 * says why (the outage path is the schedule tests' and chaos-mirror's).
 */

const ARCHIVE_PROBE = "https://archive.org/services/check";

interface LiveProbe {
  el: HTMLMediaElement | null;
  src: string | null;
}

/** Hold on to the player's element from its first real play(). */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hdLive: { el: HTMLMediaElement | null; src: string | null } };
    w.__hdLive = { el: null, src: null };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      // The radio static is Web Audio, not an element; the only element with
      // a real http(s) source is the player's.
      if (!w.__hdLive.el && this.src && /^https?:/.test(this.src)) w.__hdLive.el = this;
      return play.call(this);
    };
  });
}

/** Where this page's element is on the station, against the shared wall clock; null until audible. */
function position(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { __hdLive: LiveProbe }).__hdLive;
    const el = p.el;
    if (!el || el.paused || el.readyState < 2 || el.currentTime <= 0) return null;
    return { currentTime: el.currentTime, lead: el.currentTime - Date.now() / 1000, src: el.currentSrc };
  });
}

async function tuneIn(page: Page) {
  await page.goto("/live");
  const button = page.getByTestId("live-tune-in");
  // The button renders once the program is on screen.
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}

test("two listeners tuned in land within 2 s of each other", async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const reachable = await request
    .head(ARCHIVE_PROBE, { timeout: 10_000 })
    .then((r) => r.status() < 500)
    .catch(() => false);
  test.skip(!reachable, "archive.org is not reachable from this machine; the station would be on the mirror");

  // The second listener: its own profile and client address, with the same
  // protections the fixture gives the first (no stats writes reach the
  // server, no service worker).
  const use = info.project.use;
  const other: BrowserContext = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": anotherClientAddress(info.workerIndex) },
  });
  const otherWrites: string[] = [];
  try {
    const late = await other.newPage();
    await answerServerWrites(late, otherWrites);
    await installProbe(page);
    await installProbe(late);

    await tuneIn(page);
    // A late joiner: the first listener is already some way into the show.
    await expect.poll(() => position(page), { timeout: 60_000 }).not.toBeNull();
    await tuneIn(late);
    await expect.poll(() => position(late), { timeout: 60_000 }).not.toBeNull();

    // Both on the same show...
    const [a0, b0] = await Promise.all([position(page), position(late)]);
    expect(b0!.src).toBe(a0!.src);
    // ...and mid-show: the late joiner started where the station was, not at 0.
    const schedule = await (await request.get("/api/live/schedule")).json();
    if ("slot" in schedule.now && schedule.now.slot.fileHash && schedule.now.offsetSec > 10) {
      expect(b0!.currentTime).toBeGreaterThan(5);
    }

    // Within 2 s of each other, held over a few samples rather than one lucky read.
    for (let i = 0; i < 3; i++) {
      const [a, b] = await Promise.all([position(page), position(late)]);
      expect(a, "first listener still playing").not.toBeNull();
      expect(b, "late listener still playing").not.toBeNull();
      expect(Math.abs(a!.lead - b!.lead), `sample ${i}: ${a!.currentTime} vs ${b!.currentTime}`).toBeLessThan(2);
      await page.waitForTimeout(2_000);
    }
  } finally {
    await other.close();
  }
});
