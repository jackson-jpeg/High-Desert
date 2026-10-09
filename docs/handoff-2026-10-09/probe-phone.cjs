// Phone probe, WebKit at 390 wide (2026-10-09). Screenshots of real states on a URL.
//
//   node docs/handoff-2026-10-09/probe-phone.cjs <base-url> <out-dir> [--fail]
//
// Nothing it does is written to the server: every stats write and the phone
// lines' tune-in notice are answered in the page (the same pattern as
// e2e/fixtures.ts), and the service worker is blocked so page.route() sees
// every fetch.
//
// Audio: archive.org is not reached. Each archive.org/download request is
// fetched from the site's own /mirror/{fileHash} instead (Range header kept),
// so the show actually plays. An earlier probe aborted the audio, and its
// "Audio source not supported" screenshot was that abort, not WebKit.
// With --fail, the mirror is refused too, to show the failure state.
const { webkit, devices } = require("@playwright/test");

const [base, out, flag] = process.argv.slice(2);
if (!base || !out) {
  console.error("usage: probe-phone.cjs <base-url> <out-dir> [--fail]");
  process.exit(2);
}
const FAIL = flag === "--fail";
const SERVER_WRITES = /(\/api\/(stats\/(play|stop|rate|heartbeat|funnel)|playback-event)|\/live-api\/tuned)(\?|$)/;
const ARCHIVE = /^https:\/\/archive\.org\/download\/([^/]+)\/([^?#]+)/;

(async () => {
  const browser = await webkit.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  const page = await context.newPage();
  const writes = [];
  await page.route(SERVER_WRITES, (route) => {
    writes.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  const fromMirror = [];
  await page.route(ARCHIVE, async (route) => {
    if (FAIL) return route.abort();
    const [, id, file] = ARCHIVE.exec(route.request().url());
    const hash = `archive:${id}:${decodeURIComponent(file)}`;
    const url = `${base}/mirror/${encodeURIComponent(hash)}`;
    fromMirror.push(url);
    try {
      const response = await route.fetch({ url });
      return await route.fulfill({ response });
    } catch {
      // The page moved on (navigation, a new src) while this was in flight.
    }
  });
  if (FAIL) await page.route(/\/mirror\/archive(:|%3A)/i, (route) => route.abort());

  // Keep the player's detached element, to read whether time moves on it.
  await page.addInitScript(() => {
    window.__hdEl = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src && /^https?:/.test(this.src) && !/station-(id|quiet)/.test(this.src)) window.__hdEl = this;
      return play.call(this);
    };
  });
  await page.goto(`${base}/live`);
  const listen = page.getByTestId("live-tune-in");
  await listen.waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: `${out}/1-live-before-tap.png` });
  await listen.tap();

  if (FAIL) {
    await page.getByRole("alertdialog").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: `${out}/3-failed-start.png` });
    const shown = await page.evaluate(() => ({
      dialog: document.querySelectorAll('[role="alertdialog"]').length,
      banner: !!document.querySelector('[data-testid="player-error-banner"]'),
    }));
    console.log(JSON.stringify(shown));
  } else {
    // Playing means the element's time moves while it is unpaused.
    const read = () => page.evaluate(() => {
      const el = window.__hdEl;
      return el ? { t: el.currentTime, paused: el.paused, ready: el.readyState, error: el.error && el.error.code } : null;
    });
    await page.waitForTimeout(15_000);
    const a = await read();
    await page.waitForTimeout(5_000);
    const b = await read();
    await page.screenshot({ path: `${out}/2-live-playing.png` });
    const dialog = await page.getByRole("alertdialog").count();
    const playing = !!(a && b && !b.paused && b.t > a.t + 3);
    console.log(JSON.stringify({ playing, a, b, dialog }));
    await page.goto(`${base}/library`);
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: `${out}/4-library-bottom.png` });
  }
  console.log(JSON.stringify({ writesAnswered: writes.length, mirrorFetches: fromMirror.length }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
