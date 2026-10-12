/**
 * A shared moment plays from its second (docs/show-pages.md, "Sharing").
 *
 * `/show/<slug>?t=<seconds>` is the show's page, rendered per request: its
 * player starts at t (a `#t=` fragment on each source, and the Play button
 * seeks there), and "Open in High Desert" carries t into the library, whose
 * next start of the show begins there. Unit tests hold each piece; this is the
 * one place a real browser decodes real bytes and reports `currentTime`.
 *
 * The audio is four hours of silence served in the page (scripts/e2e-mirror.mjs),
 * for archive.org and /mirror alike: the spec depends on neither.
 */
import { test, expect, type Page } from "./fixtures";
import { FIXTURE_BYTES, fixtureBytes } from "../scripts/e2e-mirror.mjs";

const SLUG = "1992-12-12-area-51-john-lear-bob-lazar";
const T = 600;

/** Every episode's audio, from either source, is the silent fixture, ranges included. */
async function silentAudio(page: Page): Promise<void> {
  await page.route(/(archive\.org\/download\/|\/mirror\/archive)/, (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()["range"] ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(range?.[2] ? Number(range[2]) : start + 512 * 1024 - 1, FIXTURE_BYTES - 1);
    return route.fulfill({
      status: range ? 206 : 200,
      headers: {
        "content-type": "audio/mpeg",
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*",
        ...(range ? { "content-range": `bytes ${start}-${end}/${FIXTURE_BYTES}` } : {}),
      },
      body: range ? fixtureBytes(start, end) : fixtureBytes(0, FIXTURE_BYTES - 1),
    });
  });
}

/** The element the app's player plays (it is never in the DOM): recorded by wrapping play(). */
async function watchPlayer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __hdMoment: HTMLMediaElement | null };
    w.__hdMoment = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.src && !this.src.startsWith("data:") && !/station-/.test(this.src)) w.__hdMoment = this;
      return play.call(this);
    };
  });
}

const playerTime = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hdMoment: HTMLMediaElement | null }).__hdMoment?.currentTime ?? -1);

test("the moment's page plays from t, and its card and canonical say so", async ({ page }) => {
  await silentAudio(page);
  const res = await page.goto(`/show/${SLUG}?t=${T}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()["cache-control"]).toMatch(/no-store|private/);
  await expect(page.locator(`.hd-show-moment[data-moment="${T}"]`)).toContainText("10:00");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/show/${SLUG}$`));
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/moment/${T}/opengraph-image`));

  const play = page.getByTestId("show-play");
  await expect(play).toContainText("Play from 10:00");
  await play.click();
  const audio = page.locator("audio#hd-show-audio");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (a.paused ? -1 : a.currentTime)), { timeout: 20_000 }).toBeGreaterThanOrEqual(T);
});

test("Open in High Desert carries the moment: the show's ▶ in the library starts at t", async ({ page, serverWrites }) => {
  await silentAudio(page);
  await watchPlayer(page);
  await page.goto(`/show/${SLUG}?t=${T}`);
  await page.locator("a.hd-show-open").click();
  await expect(page).toHaveURL(/\/library$/, { timeout: 30_000 });
  // Open is a link inside the page: if the tap's activation still counts when
  // the show is found, it starts at once; if not, the library starts nothing
  // and says "Press play". Either way the show's next start is at t.
  const hint = page.getByText("Press play to start at 10:00.");
  await expect.poll(async () => (await hint.isVisible()) || (await playerTime(page)) >= 0, { timeout: 30_000 }).toBe(true);
  if ((await playerTime(page)) < 0) await page.getByRole("button", { name: "▶ Play" }).first().click();
  await expect.poll(() => playerTime(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(T);
  // The listen was counted, and answered in the page, not by the server.
  await expect.poll(() => serverWrites.includes("/api/stats/play")).toBe(true);
});
