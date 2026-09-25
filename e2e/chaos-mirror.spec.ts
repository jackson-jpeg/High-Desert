/**
 * Chaos: archive.org is unreachable from the listener's browser. Does the show
 * still play, from the mirror, and how long until there is sound?
 *
 * Production only, and only on request — it needs the real mirror
 * (services/mirror) behind nginx, which the CI server does not have:
 *
 *   E2E_CHAOS=1 E2E_BASE_URL=https://highdesert.space \
 *   E2E_CHAOS_PINNED="<title of a pinned show>" E2E_CHAOS_UNPINNED="<title of an unpinned show>" \
 *   npx playwright test e2e/chaos-mirror.spec.ts --project=desktop
 *
 * Every archive.org host is aborted in the page, so the browser sees exactly
 * what an outage looks like to it. The mirror *server* can still reach
 * archive.org, which matters for the unpinned case: there the gateway fills
 * from the archive.org webseed, so this measures "the listener's path to
 * archive.org is broken", not a true outage. In a true outage an unpinned
 * show has no webseed and — measured, docs/torrent-mirror-feasibility.md — no
 * outside peers, so it would 503 after 15s and raise the error dialog.
 *
 * Stats writes are answered in the page by the fixture, so nothing lands in
 * the production database.
 */
import { expect, test, type Page } from "./fixtures";
import { episodeList, openLibrary } from "./library";

test.skip(!process.env.E2E_CHAOS, "chaos run: E2E_CHAOS=1 against production only");
test.skip(({ isMobile }) => isMobile, "one project is enough; the failover is not layout-dependent");

const ARCHIVE = /^https?:\/\/([a-z0-9-]+\.)*archive\.org\//i;

interface Probe {
  clickedAt: number;
  sources: string[];
  firstAudioAt: number | null;
  /** First audible moment per source URL: several shows play through one element. */
  audioAt: Record<string, number>;
  currentTime: number;
}

/** Hold on to the player's element — a detached `new Audio()`, never in the DOM — from its first play(). */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hdChaos: Probe & { el: HTMLMediaElement | null } };
    w.__hdChaos = { clickedAt: 0, sources: [], firstAudioAt: null, audioAt: {}, currentTime: 0, el: null };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const probe = w.__hdChaos;
      if (!probe.el && this.src && !this.src.startsWith("data:")) {
        probe.el = this;
        const note = () => {
          // load() after removeAttribute("src") fires loadstart with no source.
          if (this.currentSrc && probe.sources[probe.sources.length - 1] !== this.currentSrc) probe.sources.push(this.currentSrc);
        };
        this.addEventListener("loadstart", note);
        this.addEventListener("timeupdate", () => {
          probe.currentTime = this.currentTime;
          if (!this.paused && this.currentTime > 0) {
            if (probe.firstAudioAt === null) probe.firstAudioAt = performance.now();
            probe.audioAt[this.currentSrc] ??= performance.now();
          }
        });
        note();
      }
      return play.call(this);
    };
  });
}

const probe = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __hdChaos: Probe }).__hdChaos;
    return { clickedAt: p.clickedAt, sources: [...p.sources], firstAudioAt: p.firstAudioAt, audioAt: { ...p.audioAt }, currentTime: p.currentTime };
  });

async function playTitle(page: Page, title: string, { reload = true } = {}) {
  if (reload) {
    await page.goto(`/library?q=${encodeURIComponent(title)}`);
  } else {
    // In the running page: a navigation would reset the health verdict the
    // test is about.
    const box = page.getByPlaceholder(/^Search episodes/);
    await box.fill(title);
  }
  const row = episodeList(page).locator('[role="option"]').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toHaveAttribute("aria-label", new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const mark = () =>
    page.evaluate(() => {
      (window as unknown as { __hdChaos: Probe }).__hdChaos.clickedAt = performance.now();
    });
  if (reload) {
    await row.click();
    await mark();
    await page.keyboard.press("Enter");
  } else {
    // Focus is in the search combobox, which owns Enter; a double-click is
    // the row's own play gesture.
    await mark();
    await row.dblclick();
  }
}

for (const [label, title] of [
  ["pinned", process.env.E2E_CHAOS_PINNED],
  ["unpinned", process.env.E2E_CHAOS_UNPINNED],
] as const) {
  test(`archive.org down in the browser: a ${label} show plays from the mirror`, async ({ page }, info) => {
    test.skip(!title, `set E2E_CHAOS_${label.toUpperCase()} to a show's title`);
    test.setTimeout(120_000);
    const aborted: string[] = [];
    await page.route(ARCHIVE, (route) => {
      aborted.push(route.request().url());
      return route.abort("connectionrefused");
    });
    await installProbe(page);
    await openLibrary(page);
    await playTitle(page, title!);

    // The same element moves to the mirror...
    await expect.poll(async () => (await probe(page)).sources.some((s) => s.includes("/mirror/")), { timeout: 45_000 }).toBe(true);
    // ...and there is sound: currentTime advances, not merely a source assigned.
    await expect.poll(async () => (await probe(page)).firstAudioAt, { timeout: 45_000 }).not.toBeNull();
    const t0 = (await probe(page)).currentTime;
    await page.waitForTimeout(4_000);
    const p = await probe(page);
    expect(p.currentTime - t0, "currentTime must advance on the mirror").toBeGreaterThan(2);
    await expect(page.getByTestId("via-mirror").first()).toBeVisible();

    const ttfa = Math.round(p.firstAudioAt! - p.clickedAt);
    info.annotations.push({ type: "time-to-first-audio-ms", description: String(ttfa) });
    info.annotations.push({ type: "sources", description: p.sources.map((s) => new URL(s).host + new URL(s).pathname.slice(0, 40)).join(" → ") });
    info.annotations.push({ type: "archive-requests-aborted", description: String(aborted.length) });
    console.log(`[chaos] ${label}: ${ttfa} ms to first audio; ${aborted.length} archive.org request(s) aborted; ${p.sources.length} source(s)`);
  });
}

test("once archive.org is known down, the next start goes straight to the mirror", async ({ page }, info) => {
  // The health probe runs after a media error (useAudioPlayer), and a "down"
  // verdict is held for 30s (src/services/archive/health.ts). So: one show
  // fails over, which probes; the next start inside that window must not send
  // the element to archive.org at all.
  const first = process.env.E2E_CHAOS_PINNED;
  const second = process.env.E2E_CHAOS_UNPINNED;
  test.skip(!first || !second, "set E2E_CHAOS_PINNED and E2E_CHAOS_UNPINNED");
  test.setTimeout(120_000);
  const media: string[] = [];
  await page.route(ARCHIVE, (route) => {
    if (route.request().resourceType() === "media") media.push(route.request().url());
    return route.abort("connectionrefused");
  });
  await page.route("**/api/archive/health", (route) => route.fulfill({ json: { up: false } }));
  await installProbe(page);
  await openLibrary(page);
  await playTitle(page, first!);
  await expect.poll(async () => (await probe(page)).firstAudioAt, { timeout: 45_000 }).not.toBeNull();

  const before = { media: media.length, sources: (await probe(page)).sources.length };
  await playTitle(page, second!, { reload: false });
  // The second show's own source, and sound from it — the first show keeps
  // ticking until the element moves, so "any audio" would pass on its own.
  await expect.poll(async () => (await probe(page)).sources.length, { timeout: 45_000 }).toBeGreaterThan(before.sources);
  await expect
    .poll(async () => {
      const q = await probe(page);
      return q.audioAt[q.sources[q.sources.length - 1]] ?? null;
    }, { timeout: 45_000 })
    .not.toBeNull();
  const p = await probe(page);
  const after = p.sources.slice(before.sources);
  expect(after.every((s) => s.includes("/mirror/")), `sources after the verdict: ${after.join(", ")}`).toBe(true);
  expect(media.slice(before.media), "no media request to archive.org once it is known down").toEqual([]);
  const ttfa = Math.round(p.audioAt[after[after.length - 1]] - p.clickedAt);
  info.annotations.push({ type: "time-to-first-audio-ms", description: String(ttfa) });
  console.log(`[chaos] known-down: ${ttfa} ms to first audio, straight to the mirror`);
});
