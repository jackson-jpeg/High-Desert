/**
 * Level and Clean up in the app, as a listener meets them
 * (docs/audio-processing/README.md). e2e/dsp-render.spec.ts proves the built
 * worklet computes the right audio; this proves the player uses it:
 *
 *   - Level is on by default and the show plays through the worklet (its own
 *     status messages say it hears the show and is mixed in), and the VU meter,
 *     fed after the processing, moves with the show;
 *   - a switch flipped while playing fades in or out with the show playing on;
 *     a seek and a show change keep it; both off bypasses it, still playing;
 *   - the choice is remembered across a reload;
 *   - a source the browser refuses (no CORS) fails over to the mirror and is
 *     processed there. Modelled as the load error real Chromium gives: measured
 *     2026-11-15, a cross-origin MP3 with no Access-Control-Allow-Origin on an
 *     element with crossOrigin="anonymous" is refused ("no supported source"),
 *     but the same response through page.route plays (Playwright's fulfilment
 *     skips the CORS check), so page.route cannot stage the refusal itself;
 *   - a worklet that will not load leaves plain playback, the switches greyed
 *     with the reason, never silence;
 *   - an offline cached show (a local file from OPFS) is processed;
 *   - the live station, across a handover (the station ID on the same element),
 *     stays processed.
 *
 * Every audio byte comes from page.route (the meter tone, e2e/tone-fixture.ts),
 * stats writes are answered by the fixture. Run against a local build on the
 * e2e database (the Live test reads /api/live/schedule once for real shows):
 *   E2E_BASE_URL=http://127.0.0.1:3613 npx playwright test e2e/dsp-player.spec.ts --project=desktop
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test, busEventName } from "./fixtures";
import { chooseVu, expectMetersMove, FIXTURE, serveFixture } from "./tone-fixture";
import { showOf } from "./fixture-audio";
import { communityKey } from "../src/lib/utils/community-key";

interface SeedRow {
  fileHash: string;
  fileName: string;
  archiveIdentifier?: string;
  sourceUrl?: string;
}

const seed: SeedRow[] = JSON.parse(readFileSync(path.join(process.cwd(), "public/seed/library.json"), "utf8"));
const repaired = new Set<string>(
  (JSON.parse(readFileSync(path.join(process.cwd(), "src/data/repaired-episodes.json"), "utf8")) as { fileHash: string }[]).map((r) => r.fileHash),
);
const rows = seed.filter((r) => r.archiveIdentifier && r.sourceUrl?.startsWith("https://archive.org/download/") && !repaired.has(r.fileHash));
const SHOW_A = rows[0];
const SHOW_B = rows[1];

interface Status {
  inPeak: number;
  level: { gainDb: number; mix: number };
  cleanup: { mix: number; music: number; humLines: number };
}

/**
 * Route the audio, and probe the page: the player's element (from its first
 * play()) and every message the worklet posts (the app's own handler is left
 * in place; a listener beside it sees the same messages).
 */
async function wire(page: Page, opts: { refused?: boolean; workletFails?: boolean } = {}) {
  await page.route("**/api/archive/health", (route) => route.fulfill({ json: { up: true, status: 200, checkedAt: new Date().toISOString() } }));
  await page.route(/^https:\/\/archive\.org\/download\//, (route) => (opts.refused ? route.abort("failed") : serveFixture(route, true)));
  await page.route(/\/mirror\/archive(:|%3A)/i, (route) => serveFixture(route, false));
  // Chromium's worklet module fetch bypasses page.route: refuse it where the app asks for it.
  if (opts.workletFails) {
    await page.addInitScript(() => {
      const add = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = function (this: AudioWorklet, url: string | URL, o?: WorkletOptions) {
        if (String(url).includes("dsp-worklet")) return Promise.reject(new DOMException("blocked by the test", "AbortError"));
        return add.call(this, url, o);
      };
    });
  }
  await page.addInitScript(() => {
    const w = window as unknown as { __dsp: { el: HTMLMediaElement | null; status: unknown[]; nodes: number } };
    w.__dsp = { el: null, status: [], nodes: 0 };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (/archive\.org|\/mirror\/|^blob:|\/audio\/station/.test(this.src)) w.__dsp.el = this;
      return play.call(this);
    };
    const Node = window.AudioWorkletNode;
    if (Node) {
      window.AudioWorkletNode = class extends Node {
        constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
          super(...args);
          w.__dsp.nodes++;
          this.port.addEventListener("message", (e: MessageEvent) => {
            if (e.data?.type === "status") {
              w.__dsp.status.push(e.data);
              if (w.__dsp.status.length > 50) w.__dsp.status.shift();
            }
          });
        }
      } as typeof AudioWorkletNode;
    }
  });
}

function element(page: Page) {
  return page.evaluate(() => {
    const el = (window as unknown as { __dsp: { el: HTMLMediaElement | null } }).__dsp.el;
    return el ? { src: el.currentSrc || el.src, paused: el.paused, t: el.currentTime } : null;
  });
}

function lastStatus(page: Page): Promise<Status | null> {
  return page.evaluate(() => {
    const s = (window as unknown as { __dsp: { status: Status[] } }).__dsp.status;
    return s.length ? s[s.length - 1] : null;
  });
}

/** The worklet hears the show and Level and Clean up are mixed in as `want` says. */
async function expectProcessing(page: Page, want: { level: boolean; cleanup: boolean }, when: string) {
  await expect
    .poll(
      async () => {
        const s = await lastStatus(page);
        if (!s) return "no status from the worklet";
        if (!(s.inPeak > 0)) return `inPeak ${s.inPeak}`;
        if (Math.abs(s.level.mix - (want.level ? 1 : 0)) > 0.01) return `level mix ${s.level.mix}`;
        if (Math.abs(s.cleanup.mix - (want.cleanup ? 1 : 0)) > 0.01) return `cleanup mix ${s.cleanup.mix}`;
        return "ok";
      },
      { timeout: 15_000, message: `${when}: the worklet carries the show with level ${want.level}, cleanup ${want.cleanup}` },
    )
    .toBe("ok");
}

/** The show is playing and its playhead moves. */
async function expectPlaying(page: Page, when: string) {
  const a = (await element(page))!;
  await page.waitForTimeout(1_200);
  const b = (await element(page))!;
  expect(b.paused, `${when}: playing`).toBe(false);
  expect(b.t - a.t, `${when}: the playhead moves`).toBeGreaterThan(0.6);
}

async function startShow(page: Page, row: SeedRow) {
  await page.goto(`/library?show=${encodeURIComponent(communityKey({ archiveIdentifier: row.archiveIdentifier, fileName: row.fileName })!)}`);
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
  const play = page.getByRole("button", { name: /^▶ Play$/ }).first();
  await expect(play).toBeVisible({ timeout: 30_000 });
  await play.click();
  const close = page.getByRole("button", { name: "Close detail" }).filter({ visible: true }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.keyboard.press("Escape");
  await expect.poll(async () => (await element(page))?.t ?? 0, { timeout: 20_000, message: "the show never started" }).toBeGreaterThan(0.5);
}

/** Dispatch the library's play request for a row read from the page's own IndexedDB, optionally rewritten first. */
async function playRow(page: Page, fileHash: string, rewrite?: Record<string, unknown>) {
  await page.evaluate(
    async ([name, hash, patch]) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open("HighDesertDB");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const ep = await new Promise<Record<string, unknown>>((res, rej) => {
        const g = db.transaction("episodes").objectStore("episodes").index("fileHash").get(hash);
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
      db.close();
      const detail = patch ? { ...ep, ...patch } : ep;
      if (patch) for (const [k, v] of Object.entries(patch)) if (v === null) delete detail[k];
      window.dispatchEvent(new CustomEvent(name, { detail }));
    },
    [busEventName("play-episode"), fileHash, rewrite ?? null] as const,
  );
}

const sw = (page: Page, which: "level" | "cleanup") => page.getByTestId(`dsp-${which}`).filter({ visible: true }).first();

async function openNowPlaying(page: Page) {
  for (const b of [page.getByTestId("w98-amp-expand").first(), page.getByRole("button", { name: "Expand player" }).first()]) {
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      return;
    }
  }
}

for (const look of ["win98", "night"] as const) {
  test(`${look}: Level on by default, switches while playing, seek, show change, both off, remembered`, async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    if (look === "night") await context.addCookies([{ name: "hd_look", value: "night", url: baseURL! }]);
    await wire(page);
    await startShow(page, SHOW_A);
    expect(showOf((await element(page))!.src)).toBe(SHOW_A.fileHash);

    await expect(page.getByTestId("dsp-switches").first()).toHaveAttribute("data-availability", "ok");
    await expect(sw(page, "level")).toHaveAttribute("aria-checked", "true");
    await expect(sw(page, "cleanup")).toHaveAttribute("aria-checked", "false");
    await expectProcessing(page, { level: true, cleanup: false }, "by default");

    await openNowPlaying(page);
    await chooseVu(page);
    await expectMetersMove(page, "Level on");

    await sw(page, "cleanup").click();
    await expect(sw(page, "cleanup")).toHaveAttribute("aria-checked", "true");
    await expectProcessing(page, { level: true, cleanup: true }, "Clean up turned on while playing");
    await expectPlaying(page, "Clean up turned on while playing");

    const before = (await element(page))!.t;
    await page.getByRole("button", { name: "Seek forward 30 seconds" }).filter({ visible: true }).first().click();
    await expect.poll(async () => (await element(page))!.t, { timeout: 10_000 }).toBeGreaterThan(before + 25);
    await expectPlaying(page, "after a seek");
    await expectProcessing(page, { level: true, cleanup: true }, "after a seek");

    await playRow(page, SHOW_B.fileHash);
    await expect.poll(async () => showOf((await element(page))?.src ?? ""), { timeout: 20_000 }).toBe(SHOW_B.fileHash);
    await expectPlaying(page, "after a show change");
    await expectProcessing(page, { level: true, cleanup: true }, "after a show change");
    await expectMetersMove(page, "after a show change");

    await sw(page, "level").click();
    await sw(page, "cleanup").click();
    await expect(sw(page, "level")).toHaveAttribute("aria-checked", "false");
    await expectProcessing(page, { level: false, cleanup: false }, "both off");
    await expectPlaying(page, "both off");
    await expectMetersMove(page, "both off");

    // Remembered: Level off, Clean up on, across a reload.
    await sw(page, "cleanup").click();
    await page.reload();
    await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
    await expect(sw(page, "level")).toHaveAttribute("aria-checked", "false");
    await expect(sw(page, "cleanup")).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("hd-dsp"))).toBe(JSON.stringify({ level: false, cleanup: true }));
  });
}

test("a source the browser refuses (no CORS) fails over to the mirror, and the mirror is processed", async ({ page }) => {
  test.setTimeout(90_000);
  await wire(page, { refused: true });
  await startShow(page, SHOW_A);
  expect((await element(page))!.src, "played from the mirror").toMatch(/\/mirror\/archive/);
  await expectPlaying(page, "on the mirror");
  await expectProcessing(page, { level: true, cleanup: false }, "on the mirror");
});

test("a worklet that will not load: plain playback, switches greyed with the reason", async ({ page }) => {
  test.setTimeout(90_000);
  await wire(page, { workletFails: true });
  await startShow(page, SHOW_A);
  await expect(page.getByTestId("dsp-switches").first()).toHaveAttribute("data-availability", "failed");
  await expect(sw(page, "level")).toHaveAttribute("aria-disabled", "true");
  await expect(sw(page, "level")).toHaveAttribute("aria-checked", "false");
  await expectPlaying(page, "with the worklet failed");
  await openNowPlaying(page);
  await chooseVu(page);
  await expectMetersMove(page, "with the worklet failed");
  // A greyed switch ignores a tap (forced: Playwright waits on aria-disabled).
  await sw(page, "level").click({ force: true });
  await expect(sw(page, "level")).toHaveAttribute("aria-checked", "false");
});

test("an offline cached show (a local file from OPFS) is processed", async ({ page }) => {
  test.setTimeout(90_000);
  await wire(page);
  await startShow(page, SHOW_A);
  await expectProcessing(page, { level: true, cleanup: false }, "the archive show");
  // The cache, as a scanned local file leaves it: the bytes in OPFS under the row's key.
  const LOCAL = "local:dsp-e2e-fixture.mp3";
  await page.evaluate(
    async ([key, bytes]) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("audio-cache", { create: true });
      const fh = await dir.getFileHandle(key.replace(/[^a-zA-Z0-9_-]/g, "_"), { create: true });
      const w = await fh.createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
    },
    [LOCAL, Array.from(FIXTURE)] as const,
  );
  await playRow(page, SHOW_B.fileHash, { fileHash: LOCAL, fileName: "dsp-e2e-fixture.mp3", sourceUrl: null, archiveIdentifier: null, id: null });
  await expect.poll(async () => (await element(page))?.src ?? "", { timeout: 20_000 }).toMatch(/^blob:/);
  await expectPlaying(page, "the cached show");
  await expectProcessing(page, { level: true, cleanup: false }, "the cached show");
});

test("the live station stays processed across a handover", async ({ page }) => {
  test.setTimeout(120_000);
  await wire(page);
  const real = await (await page.request.get("/api/live/schedule")).json();
  type Slot = { fileHash: string; start: number; end: number; duration: number; [k: string]: unknown };
  const pool: Slot[] = [real.now?.slot, ...real.upNext, ...real.guide].filter(Boolean);
  const a0 = pool[0];
  const b0 = pool.find((s) => s.fileHash !== a0.fileHash)!;
  const t0 = Date.now();
  const A: Slot = { ...a0, start: t0 - 60_000, end: t0 + 25_000, duration: 85 };
  const B: Slot = { ...b0, start: A.end + 8_000, end: A.end + 8_000 + 3_600_000, duration: 3600 };
  await page.route(/\/api\/live\/schedule(\?|$)/, (route) => {
    const now = Date.now();
    const on =
      now < A.end
        ? { slot: A, startedAt: A.start, offsetSec: (now - A.start) / 1000, endsAt: A.end }
        : now < B.start
          ? { stationId: true, endsAt: B.start }
          : { slot: B, startedAt: B.start, offsetSec: (now - B.start) / 1000, endsAt: B.end };
    return route.fulfill({
      json: { day: real.day, tz: real.tz, serverNow: now, stationIdSec: 8, now: on, upNext: now < B.start ? [B] : [], rest: [], guide: [A, B], outage: false },
      headers: { "cache-control": "no-store" },
    });
  });
  await page.goto("/live");
  await page.getByTestId("live-tune-in").filter({ visible: true }).first().click();
  await expect.poll(async () => showOf((await element(page))?.src ?? ""), { timeout: 30_000 }).toBe(A.fileHash);
  await expectPlaying(page, "show A on the station");
  await expectProcessing(page, { level: true, cleanup: false }, "show A on the station");
  await expect
    .poll(async () => showOf((await element(page))?.src ?? ""), { timeout: B.start - Date.now() + 30_000, message: "B never started" })
    .toBe(B.fileHash);
  await expectPlaying(page, "show B after the handover");
  await expectProcessing(page, { level: true, cleanup: false }, "show B after the handover");
  await expect(page.getByTestId("dsp-switches").first()).toHaveAttribute("data-availability", "ok");
});
