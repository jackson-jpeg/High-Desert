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
 *
 * Outage mode (the last two tests) is driven by the health verdict, so there
 * `/api/archive/health` is also answered in the page with `{up: false}` — the
 * one thing a browser-side block cannot make the server believe. Titles for
 * those tests are picked from the live `/mirror/manifest` and the seed catalog,
 * so no environment variable is needed and a re-warm cannot make them stale.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { episodeList, openLibrary } from "./library";

test.skip(!process.env.E2E_CHAOS, "chaos run: E2E_CHAOS=1 against production only");
test.skip(({ isMobile }) => isMobile, "one project is enough; the failover is not layout-dependent");

const ARCHIVE = /^https?:\/\/([a-z0-9-]+\.)*archive\.org\//i;

interface SeedRow {
  fileHash: string;
  title?: string;
}

/**
 * Two shows the mirror holds and one it does not, each with a title no other
 * catalog row shares (the tests find rows by title).
 */
async function catalogPicks(baseURL: string) {
  const seed: SeedRow[] = JSON.parse(readFileSync(path.join(process.cwd(), "public/seed/library.json"), "utf8"));
  const res = await fetch(new URL("/mirror/manifest", baseURL));
  expect(res.ok, "the mirror's manifest must be reachable").toBe(true);
  const held = new Set<string>((await res.json()).fileHashes);
  const titles = new Map<string, number>();
  for (const r of seed) if (r.title) titles.set(r.title, (titles.get(r.title) ?? 0) + 1);
  // Titles the search box will find as themselves: unique, and plain enough
  // that no other row's title contains them.
  const usable = seed.filter(
    (r) => r.title && titles.get(r.title) === 1 && /^[A-Za-z0-9 ,'-]{8,40}$/.test(r.title) &&
      !seed.some((o) => o !== r && o.title?.toLowerCase().includes(r.title!.toLowerCase())),
  );
  const pinned = usable.filter((r) => held.has(r.fileHash)).map((r) => r.title!);
  const unpinned = usable.filter((r) => !held.has(r.fileHash)).map((r) => r.title!);
  expect(pinned.length, "need two pinned shows with unique titles").toBeGreaterThanOrEqual(2);
  expect(unpinned.length, "need an unpinned show with a unique title").toBeGreaterThanOrEqual(1);
  return { pinned: pinned.slice(0, 2), unpinned: unpinned[0] };
}

interface Probe {
  clickedAt: number;
  sources: string[];
  firstAudioAt: number | null;
  /** First audible moment per source URL: several shows play through one element. */
  audioAt: Record<string, number>;
  currentTime: number;
  /** When the outage dialog first appeared. */
  dialogAt: number | null;
}

/** Hold on to the player's element — a detached `new Audio()`, never in the DOM — from its first play(). */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hdChaos: Probe & { el: HTMLMediaElement | null } };
    w.__hdChaos = { clickedAt: 0, sources: [], firstAudioAt: null, audioAt: {}, currentTime: 0, el: null, dialogAt: null };
    // When the outage dialog first appears, to the millisecond, in page time —
    // the same clock as clickedAt, so the wait is measured without Playwright's
    // own polling in it.
    new MutationObserver(() => {
      if (w.__hdChaos.dialogAt === null && document.querySelector("[data-testid=outage-dialog]")) {
        w.__hdChaos.dialogAt = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
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
    return { clickedAt: p.clickedAt, sources: [...p.sources], firstAudioAt: p.firstAudioAt, audioAt: { ...p.audioAt }, currentTime: p.currentTime, dialogAt: p.dialogAt };
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

test("once archive.org is known down, the next start goes straight to the mirror", async ({ page, baseURL }, info) => {
  // The health verdict is "down" from the first probe (useOutageMonitor, on
  // load), so neither start may send the element to archive.org at all. Both
  // shows are pinned: an unpinned one is refused outright in outage mode —
  // that is the next test.
  const { pinned } = await catalogPicks(baseURL!);
  const [first, second] = pinned;
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

test("outage mode: banner, marks, Playable now; an unpinned start is refused in under a second; a pinned one plays", async ({ page, baseURL }, info) => {
  const { pinned, unpinned } = await catalogPicks(baseURL!);
  test.setTimeout(120_000);
  const media: string[] = [];
  await page.route(ARCHIVE, (route) => {
    if (route.request().resourceType() === "media") media.push(route.request().url());
    return route.abort("connectionrefused");
  });
  await page.route("**/api/archive/health", (route) => route.fulfill({ json: { up: false } }));
  await installProbe(page);
  await openLibrary(page);

  // The banner, in its words; "Playable now" on; pinned rows marked.
  await expect(page.getByTestId("outage-banner")).toContainText("archive.org is down. Playing from the High Desert mirror.");
  const toggle = page.getByTestId("playable-now");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(episodeList(page).locator('[role="option"][data-availability="mirror"]').first()).toBeVisible();
  await expect(episodeList(page).locator('[role="option"][data-availability="unavailable"]')).toHaveCount(0);

  // Everything, dimmed where it cannot play.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.getByPlaceholder(/^Search episodes/).fill(unpinned);
  const row = episodeList(page).locator('[role="option"]').first();
  await expect(row).toHaveAttribute("aria-label", new RegExp(`^${unpinned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await expect(row).toHaveAttribute("data-availability", "unavailable");

  // An unpinned start: the dialog, fast, and nothing asked of the network.
  const mediaBefore = media.length;
  const sourcesBefore = (await probe(page)).sources.length;
  await page.evaluate(() => {
    (window as unknown as { __hdChaos: Probe }).__hdChaos.clickedAt = performance.now();
  });
  await row.dblclick();
  const dialog = page.getByTestId("outage-dialog");
  await expect(dialog).toBeVisible();
  const p = await probe(page);
  const refusedMs = Math.round(p.dialogAt! - p.clickedAt);
  expect(refusedMs, "the refusal must not wait on the network").toBeLessThan(1000);
  expect(p.sources.length, "no source was assigned for it").toBe(sourcesBefore);
  expect(media.slice(mediaBefore)).toEqual([]);

  // Three shows that play; take one.
  const offers = dialog.locator("[data-suggestion]");
  await expect(offers).toHaveCount(3);
  await offers.first().click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await probe(page)).sources.some((s) => s.includes("/mirror/")), { timeout: 45_000 }).toBe(true);
  await expect.poll(async () => (await probe(page)).firstAudioAt, { timeout: 45_000 }).not.toBeNull();
  const started = await probe(page);
  const suggestionTtfa = Math.round(started.firstAudioAt! - started.clickedAt);

  // And a pinned start from the list plays.
  await playTitle(page, pinned[0], { reload: false });
  await expect
    .poll(async () => {
      const q = await probe(page);
      const last = q.sources[q.sources.length - 1];
      return last?.includes("/mirror/") && q.audioAt[last] ? true : null;
    }, { timeout: 45_000 })
    .toBe(true);
  expect(media, "no media request to archive.org in outage mode").toEqual([]);

  info.annotations.push({ type: "refused-in-ms", description: String(refusedMs) });
  console.log(`[chaos] outage mode: unpinned refused in ${refusedMs} ms; suggestion playing ${suggestionTtfa} ms after the refused tap; pinned "${pinned[0]}" plays`);
});
