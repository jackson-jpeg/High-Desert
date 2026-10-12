/**
 * The meters move while a show plays: on an iPhone, and everywhere else.
 *
 * Jackson's report (2026-10-12): on iPhone the now playing screen's
 * visualizer was solid black and the VU needles sat at zero while the show
 * was audibly playing. iOS never routes the player's element through Web
 * Audio (that stops playback on the lock screen), so the engine has no
 * analyser there and every visualizer drew its idle frame. The level tap
 * (src/audio/levels.ts) reads the same bytes the element plays instead.
 *
 * What this holds, by looking at the rendered VU meter itself (the needle's
 * angle read off the canvas, never a test-only number): real audio, a
 * committed tone whose level alternates loud and quiet every second
 * (e2e/assets/meter-tone.mp3), served for every URL shape the player plays:
 *
 *   - archive.org: `https://archive.org/download/...`, with CORS as its
 *     storage nodes send it (`Access-Control-Allow-Origin: *` and no exposed
 *     headers, so `Content-Range` is unreadable to a script);
 *   - this origin's `/mirror/{fileHash}` (pinned, slice-filled and the
 *     direct-storage fallback all come out of nginx at that one path),
 *     reached in outage mode;
 *   - a repaired show, which plays from the mirror only.
 *
 * The needles must swing with the tone during playback, again after pause
 * and resume, after a show change, and after a lock-screen return (the page
 * hidden, then visible). On an iPhone the element must never be handed to
 * Web Audio (`createMediaElementSource`), and nothing may be fetched for the
 * meters while the page is hidden.
 *
 * Stats writes are answered in the page by the fixture; every audio byte
 * comes from page.route, so no archive.org or mirror server is involved.
 *
 * The real archive.org (its 302 to a storage node, `ia*.us.archive.org` or
 * `dn*.ca.archive.org`, which page.route cannot follow) is the last test,
 * on request only: E2E_REAL_ARCHIVE=1.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { expect, test, busEventName } from "./fixtures";
import { openLibrary } from "./library";
import { communityKey } from "../src/lib/utils/community-key";

const FIXTURE = readFileSync(path.join(process.cwd(), "e2e", "assets", "meter-tone.mp3"));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

interface SeedRow {
  fileHash: string;
  fileName: string;
  archiveIdentifier?: string;
  sourceUrl?: string;
}

const seed: SeedRow[] = JSON.parse(readFileSync(path.join(process.cwd(), "public/seed/library.json"), "utf8"));
const repairedHashes = new Set<string>(
  (JSON.parse(readFileSync(path.join(process.cwd(), "src/data/repaired-episodes.json"), "utf8")) as { fileHash: string }[]).map(
    (r) => r.fileHash,
  ),
);
const archiveRows = seed.filter((r) => r.archiveIdentifier && r.sourceUrl?.startsWith("https://archive.org/download/") && !repairedHashes.has(r.fileHash));
const SHOW_ARCHIVE = archiveRows[0];
const SHOW_ARCHIVE_2 = archiveRows[1];
const SHOW_MIRROR = archiveRows[2];
const SHOW_REPAIRED = seed.find((r) => repairedHashes.has(r.fileHash))!;

/** Answer an audio request from the fixture, honouring a single byte range. */
function serveFixture(route: Route, cors: boolean) {
  const req = route.request();
  const corsHeaders: Record<string, string> = cors ? { "access-control-allow-origin": "*" } : {};
  if (req.method() === "OPTIONS") {
    return route.fulfill({
      status: 204,
      headers: { ...corsHeaders, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Range" },
    });
  }
  const size = FIXTURE.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers()["range"] ?? "");
  if (!m) {
    return route.fulfill({ status: 200, body: FIXTURE, headers: { ...corsHeaders, "content-type": "audio/mpeg", "accept-ranges": "bytes" } });
  }
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size) {
    return route.fulfill({ status: 416, headers: { ...corsHeaders, "content-range": `bytes */${size}` } });
  }
  return route.fulfill({
    status: 206,
    body: FIXTURE.subarray(start, end + 1),
    headers: { ...corsHeaders, "content-type": "audio/mpeg", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}` },
  });
}

interface Wiring {
  /** Requests for audio bytes made by `fetch` (the level tap), not by the element. */
  tapFetches: { url: string; at: number }[];
}

/**
 * Route every audio URL shape to the fixture, set archive.org's health, and
 * install the page probes: the player's element (from its first play()) and
 * a count of `createMediaElementSource` calls.
 */
async function wire(page: Page, opts: { archiveUp: boolean; manifest?: string[] }): Promise<Wiring> {
  const wiring: Wiring = { tapFetches: [] };
  if (process.env.METERS_DEBUG) {
    page.on("console", (m) => console.log("console:", m.type(), m.text()));
    page.on("request", (r) => /archive|mirror/.test(r.url()) && console.log("req:", r.method(), r.resourceType(), r.url().slice(0, 90), r.headers()["range"] ?? ""));
    page.on("requestfailed", (r) => console.log("failed:", r.url().slice(0, 90), r.failure()?.errorText));
    page.on("response", (r) => /archive|mirror/.test(r.url()) && console.log("res:", r.status(), r.url().slice(0, 90)));
  }
  page.on("request", (req) => {
    const u = req.url();
    if (req.resourceType() === "fetch" && req.method() === "GET" && (/archive\.org\//.test(u) || /\/mirror\/archive/.test(u))) {
      wiring.tapFetches.push({ url: u, at: Date.now() });
    }
  });
  await page.route("**/api/archive/health", (route) =>
    route.fulfill({ json: { up: opts.archiveUp, status: opts.archiveUp ? 200 : 503, checkedAt: new Date().toISOString() } }),
  );
  if (opts.manifest) {
    const hashes = opts.manifest;
    await page.route("**/mirror/manifest", (route) =>
      route.fulfill({
        json: { version: "meters", count: hashes.length, pinned: hashes.length, repaired: 0, fileHashes: hashes },
        headers: { etag: '"meters"' },
      }),
    );
  }
  // archive.org's audio, as the storage node answers it. Not through a 302:
  // Playwright routes only the first URL of a redirect, so the hop to the
  // node would leave the page for the real network. The real redirect chain
  // is the last test here (E2E_REAL_ARCHIVE), and the tap's handling of it is
  // in src/audio/level-tap/__tests__.
  await page.route(/^https:\/\/archive\.org\/download\//, (route) => serveFixture(route, true));
  await page.route(/\/mirror\/archive(:|%3A)/i, (route) => serveFixture(route, false));
  await page.addInitScript(() => {
    const w = window as unknown as { __hdMeters: { el: HTMLMediaElement | null; mediaSources: number }; __hdHidden: boolean };
    w.__hdMeters = { el: null, mediaSources: 0 };
    w.__hdHidden = false;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (/archive\.org|\/mirror\//.test(this.src)) w.__hdMeters.el = this;
      return play.call(this);
    };
    const Ctx = window.AudioContext;
    if (Ctx) {
      const create = Ctx.prototype.createMediaElementSource;
      Ctx.prototype.createMediaElementSource = function (this: AudioContext, el: HTMLMediaElement) {
        w.__hdMeters.mediaSources++;
        return create.call(this, el);
      };
    }
    // A lock screen, as the page sees it: hidden, then visible again.
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (w.__hdHidden ? "hidden" : "visible"),
    });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => w.__hdHidden });
  });
  return wiring;
}

/** What the player's element is doing. */
function element(page: Page) {
  return page.evaluate(() => {
    const el = (window as unknown as { __hdMeters: { el: HTMLMediaElement | null } }).__hdMeters.el;
    return el ? { src: el.currentSrc, paused: el.paused, t: el.currentTime } : null;
  });
}

/** Open a show's detail through the library's own `?show=` intent and press its Play button. */
async function startShow(page: Page, row: SeedRow) {
  await page.goto(`/library?show=${encodeURIComponent(communityKey({ archiveIdentifier: row.archiveIdentifier, fileName: row.fileName })!)}`);
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
  const play = page.getByRole("button", { name: /^▶ Play$/ }).first();
  await expect(play).toBeVisible({ timeout: 30_000 });
  await play.click();
  // The detail (a sheet on a phone) would cover the player.
  const close = page.getByRole("button", { name: "Close detail" }).filter({ visible: true }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.keyboard.press("Escape");
  await expect.poll(async () => (await element(page))?.t ?? 0, { timeout: 20_000, message: "the show never started" }).toBeGreaterThan(0.5);
}

/** A show change in the running page: the play request the library emits on the bus. */
async function changeShow(page: Page, row: SeedRow) {
  await page.evaluate(
    async ([name, hash]) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open("HighDesertDB");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const ep = await new Promise((res, rej) => {
        const g = db.transaction("episodes").objectStore("episodes").index("fileHash").get(hash);
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
      db.close();
      window.dispatchEvent(new CustomEvent(name, { detail: ep }));
    },
    [busEventName("play-episode"), row.fileHash] as const,
  );
}

/** The biggest visualizer on screen. */
async function bigViz(page: Page) {
  const all = page.locator('[role="button"][aria-label^="Audio visualization"]');
  let best = all.first();
  let area = -1;
  for (let i = 0; i < (await all.count()); i++) {
    const box = await all.nth(i).boundingBox();
    if (box && box.width * box.height > area) {
      area = box.width * box.height;
      best = all.nth(i);
    }
  }
  return best;
}

/** Open the now playing screen: the phone's full-screen player, or the desktop's expanded one. */
async function openNowPlaying(page: Page, look: "default" | "win98") {
  const expand =
    look === "win98" ? page.getByTestId("w98-amp-expand").first() : page.getByRole("button", { name: "Expand player" }).first();
  if (await expand.isVisible().catch(() => false)) await expand.click();
}

/** Cycle the big visualizer to the VU meter, as a listener does: tap it. */
async function chooseVu(page: Page) {
  for (let i = 0; i < 9; i++) {
    const viz = await bigViz(page);
    if ((await viz.getAttribute("aria-label")) === "Audio visualization: VU Meter") return viz;
    await viz.click();
  }
  throw new Error("never reached the VU meter");
}

/**
 * The left needle's position, 0 (rest) to 1 (full scale), read off the
 * canvas: the angle around the pivot where the white needle crosses a
 * circle inside the gauge (viz-vu.ts draws it from (0.28w, 0.6h)).
 */
function needle(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const viz = [...document.querySelectorAll('[role="button"][aria-label="Audio visualization: VU Meter"]')]
      .map((el) => el.querySelector("canvas"))
      .filter((c): c is HTMLCanvasElement => !!c)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!viz) return null;
    const W = viz.width;
    const H = viz.height;
    const data = viz.getContext("2d")!.getImageData(0, 0, W, H).data;
    const radius = Math.min(W * 0.22, H * 0.4);
    const cx = W * 0.28;
    const cy = H * 0.6;
    let best = -1;
    let bestAngle = 0;
    for (let a = -Math.PI; a <= -0.05; a += 0.005) {
      let score = 0;
      for (const f of [0.45, 0.55, 0.65]) {
        const x = Math.round(cx + Math.cos(a) * radius * f);
        const y = Math.round(cy + Math.sin(a) * radius * f);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        score += Math.min(data[i], data[i + 1], data[i + 2]);
      }
      if (score > best) {
        best = score;
        bestAngle = a;
      }
    }
    if (best < 3 * 150) return 0;
    return (bestAngle + Math.PI) / (Math.PI - 0.05);
  });
}

/** Needle positions over `ms`, every 100 ms. */
async function sampleNeedle(page: Page, ms: number): Promise<number[]> {
  const out: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    const v = await needle(page);
    if (v !== null) out.push(v);
    await page.waitForTimeout(100);
  }
  return out;
}

/**
 * The meters follow the tone: the needle reaches well up the scale on the
 * loud seconds and falls back on the quiet ones. A meter at rest, or one fed
 * anything flat, fails both.
 */
async function expectMetersMove(page: Page, when: string) {
  const s = await sampleNeedle(page, 3_500);
  const max = Math.max(...s);
  const min = Math.min(...s);
  expect(s.length, `${when}: the VU meter must be on screen`).toBeGreaterThan(20);
  expect(max, `${when}: the needle never rose (samples ${s.map((v) => v.toFixed(2)).join(" ")})`).toBeGreaterThan(0.45);
  expect(max - min, `${when}: the needle never moved with the tone (samples ${s.map((v) => v.toFixed(2)).join(" ")})`).toBeGreaterThan(0.25);
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    (window as unknown as { __hdHidden: boolean }).__hdHidden = h;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function pauseAndResume(page: Page) {
  const pause = page.getByRole("button", { name: "Pause", exact: true }).filter({ visible: true }).first();
  await pause.click();
  await expect.poll(async () => (await element(page))?.paused).toBe(true);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Play", exact: true }).filter({ visible: true }).first().click();
  await expect.poll(async () => (await element(page))?.paused).toBe(false);
}

type Device = "iphone" | "other";

async function wholeRun(page: Page, wiring: Wiring, device: Device, look: "default" | "win98", first: SeedRow, second: SeedRow, expectSrc: [RegExp, RegExp]) {
  await startShow(page, first);
  expect((await element(page))!.src).toMatch(expectSrc[0]);
  await openNowPlaying(page, look);
  await chooseVu(page);
  await expectMetersMove(page, "playing");

  await pauseAndResume(page);
  await expectMetersMove(page, "after pause and resume");

  await changeShow(page, second);
  await expect.poll(async () => (await element(page))?.src ?? "", { timeout: 20_000 }).toMatch(expectSrc[1]);
  await expect.poll(async () => (await element(page))?.t ?? 0, { timeout: 20_000 }).toBeGreaterThan(0.5);
  await expectMetersMove(page, "after a show change");

  // The lock screen: hidden for a while (the show plays on), then back.
  await setHidden(page, true);
  await page.waitForTimeout(500);
  const hiddenFrom = Date.now();
  await page.waitForTimeout(3_000);
  const hiddenTo = Date.now();
  await setHidden(page, false);
  expect((await element(page))!.paused, "the show plays on behind the lock screen").toBe(false);
  if (device === "iphone") {
    const during = wiring.tapFetches.filter((f) => f.at >= hiddenFrom && f.at <= hiddenTo);
    expect(during, "nothing is fetched for the meters while the page is hidden").toEqual([]);
  }
  await expectMetersMove(page, "after a lock-screen return");

  const sources = await page.evaluate(() => (window as unknown as { __hdMeters: { mediaSources: number } }).__hdMeters.mediaSources);
  if (device === "iphone") {
    expect(sources, "an iPhone never routes the player's element through Web Audio").toBe(0);
    expect(wiring.tapFetches.length, "the meters read the show's own bytes").toBeGreaterThan(0);
  }
}

const ARCHIVE_SRC = /^https:\/\/archive\.org\/download\//;
const MIRROR_SRC = /\/mirror\/archive/;

for (const device of ["iphone", "other"] as const) {
  test.describe(device === "iphone" ? "iPhone" : "not an iPhone", () => {
    if (device === "iphone") {
      test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
      // The iPhone describe sets its own device; once is enough.
      test.beforeEach(({}, info) => {
        test.skip(info.project.name === "mobile", "the iPhone case sets its own device");
      });
    }

    test("archive.org: playing, pause and resume, show change, lock screen", async ({ page }) => {
      const wiring = await wire(page, { archiveUp: true });
      await openLibrary(page);
      await wholeRun(page, wiring, device, "default", SHOW_ARCHIVE, SHOW_ARCHIVE_2, [ARCHIVE_SRC, ARCHIVE_SRC]);
    });

    test("the mirror (outage mode) and a repaired show (mirror only)", async ({ page }) => {
      const wiring = await wire(page, { archiveUp: false, manifest: [SHOW_MIRROR.fileHash, SHOW_REPAIRED.fileHash] });
      await openLibrary(page, { expected: 2 });
      await wholeRun(page, wiring, device, "default", SHOW_MIRROR, SHOW_REPAIRED, [MIRROR_SRC, MIRROR_SRC]);
    });

    test("a repaired show, then archive.org", async ({ page }) => {
      const wiring = await wire(page, { archiveUp: true });
      await openLibrary(page);
      await wholeRun(page, wiring, device, "default", SHOW_REPAIRED, SHOW_ARCHIVE, [MIRROR_SRC, ARCHIVE_SRC]);
    });
  });
}
