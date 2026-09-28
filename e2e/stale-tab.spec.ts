import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { playFromFixtureMirror, showOf } from "./fixture-audio";

/**
 * A tab left open on the station updates itself when a newer build is live,
 * at the gap between shows, and the station plays on (src/services/build/stale-tab.ts).
 *
 * "Deploy build B" is done in the page, not on the server: once the test says
 * so, `/api/build` answers B and the document the tab reloads to carries B in
 * its `hd-build` meta, exactly what a deploy changes for an open tab. The
 * program is synthetic, built from two real catalog shows: A has been on for a
 * minute and ends ~35 s after tune-in, then the 8 s station ID, then B. So
 * "the next slot boundary" comes inside a test's time, not a day's.
 *
 * Asserted, in order: the tab does not reload while A is playing (the new build
 * is pending the whole time); it reloads after A ends; the page is then B; and
 * B plays on the fixture's silent audio without anyone touching the page, the
 * station still tuned in. Streams from the stack's /mirror, never archive.org
 * (e2e/fixture-audio.ts).
 */

const B_BUILD = "b0b0b0b";
const A_LEFT_MS = 35_000;
const GAP_MS = 8_000;

interface Slot {
  fileHash: string;
  start: number;
  end: number;
  duration: number;
  [k: string]: unknown;
}

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hdEl: HTMLMediaElement | null };
    w.__hdEl = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.src && /^https?:/.test(this.src)) w.__hdEl = this;
      return play.call(this);
    };
  });
}

function element(page: Page) {
  return page.evaluate(() => {
    const el = (window as unknown as { __hdEl: HTMLMediaElement | null }).__hdEl;
    if (!el) return null;
    return { paused: el.paused, currentTime: el.currentTime, src: el.currentSrc || el.getAttribute("src") || "" };
  });
}

/** The page's build, read the way the app reads it (src/lib/utils/build-id.ts). */
const pageBuild = (page: Page) =>
  page.evaluate(() => document.querySelector('meta[name="hd-build"]')?.getAttribute("content") ?? null);

test("a tab on build A reloads onto build B at the gap between shows, and the station plays on", async ({ page }) => {
  test.setTimeout(150_000);
  const served = await playFromFixtureMirror(page);
  await installProbe(page);

  // Two real shows from the catalog, retimed.
  const real = await (await page.request.get("/api/live/schedule")).json();
  const pool: Slot[] = [real.now?.slot, ...real.upNext, ...real.guide].filter(Boolean);
  const a0 = pool[0];
  const b0 = pool.find((s) => s.fileHash !== a0.fileHash)!;
  expect(b0, "the program has two distinct shows to retime").toBeTruthy();
  const t0 = Date.now();
  const A: Slot = { ...a0, start: t0 - 60_000, end: t0 + A_LEFT_MS, duration: (60_000 + A_LEFT_MS) / 1000 };
  const B: Slot = { ...b0, start: A.end + GAP_MS, end: A.end + GAP_MS + 3_600_000, duration: 3600 };

  await page.route(/\/api\/live\/schedule(\?|$)/, (route) => {
    const now = Date.now();
    const on =
      now < A.end
        ? { slot: A, startedAt: A.start, offsetSec: (now - A.start) / 1000, endsAt: A.end }
        : now < B.start
          ? { stationId: true, endsAt: B.start }
          : { slot: B, startedAt: B.start, offsetSec: (now - B.start) / 1000, endsAt: B.end };
    return route.fulfill({
      json: {
        day: real.day,
        tz: real.tz,
        serverNow: now,
        stationIdSec: 8,
        now: on,
        // As the real route: the next slot(s) after now, the gap included.
        upNext: now < B.start ? [B] : [],
        rest: [],
        guide: [A, B],
        outage: false,
      },
      headers: { "cache-control": "no-store" },
    });
  });

  // The deploy, as an open tab sees it.
  let deployed = false;
  let aBuild: string | null = null;
  await page.route(/\/api\/build(\?|$)/, (route) => route.fulfill({ json: { build: deployed ? B_BUILD : aBuild } }));
  await page.route(
    (url) => url.pathname === "/live",
    async (route) => {
      if (!deployed || route.request().resourceType() !== "document") return route.fallback();
      const res = await route.fetch();
      const html = (await res.text()).replace(/(<meta name="hd-build" content=")[^"]*(")/, `$1${B_BUILD}$2`);
      return route.fulfill({ response: res, body: html });
    },
  );

  await page.goto("/live");
  aBuild = await pageBuild(page);
  expect(aBuild, "the page names its build").toMatch(/^[0-9a-f]{7,40}(-[0-9a-f]{7})?$/);
  expect(aBuild).not.toBe(B_BUILD);
  const firstDocument = await page.evaluate(() => performance.timeOrigin);

  await page.getByTestId("live-tune-in").click();
  await expect
    .poll(async () => {
      const el = await element(page);
      return !!el && !el.paused && el.currentTime > 0 && showOf(el.src) === A.fileHash;
    }, { timeout: 30_000 })
    .toBe(true);

  // B goes live. The tab hears of it at its next check (coming back on screen is one).
  deployed = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForResponse((r) => r.url().includes("/api/build"));

  // Mid-show: pending, not taken. Sampled until just before A ends.
  while (Date.now() < A.end - 3_000) {
    expect(await page.evaluate(() => performance.timeOrigin), "no reload while A is playing").toBe(firstDocument);
    const el = await element(page);
    expect(el?.paused, "A plays on").toBe(false);
    await page.waitForTimeout(2_000);
  }

  // After the boundary: the page is B.
  await expect.poll(() => pageBuild(page).catch(() => null), { timeout: A_LEFT_MS + GAP_MS + 30_000 }).toBe(B_BUILD);
  const reloadedAt = await page.evaluate(() => performance.timeOrigin);
  expect(reloadedAt, "reloaded after A ended, not mid-show").toBeGreaterThanOrEqual(A.end - 1_000);
  expect(reloadedAt, "reloaded in the gap, before B began").toBeLessThan(B.start);

  // B plays, nobody touched the page, still tuned in.
  await expect
    .poll(async () => {
      const el = await element(page);
      return !!el && !el.paused && el.currentTime > 0 && showOf(el.src) === B.fileHash;
    }, { timeout: GAP_MS + 30_000 })
    .toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("hd-live-tuned"))).toBeTruthy();
  await expect(page.getByRole("button", { name: "Leave the station" }).first()).toBeVisible();
  // One reload: the new page is on B and does not go again.
  expect(await page.evaluate(() => sessionStorage.getItem("hd-update-reloaded-for"))).toBe(B_BUILD);
  expect(served.length, "the shows were streamed from /mirror, not archive.org").toBeGreaterThan(0);
});
