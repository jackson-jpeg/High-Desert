#!/usr/bin/env node
/**
 * The returning visitor (2026-10-14, owed from docs/incident-2026-10-13/handoff.md).
 *
 * On 2026-10-13 the Library and Stats hung for a returning visitor and nothing
 * here could have seen it: deploy.sh's page check is curl (nothing hydrates,
 * IndexedDB is never opened), and every browser check starts from a fresh
 * profile with the service worker blocked. A returning visitor is the
 * opposite: a library already in IndexedDB, written by an older build, and
 * that build's service worker controlling the first page load.
 *
 * So this keeps a real profile on disk, per browser (Chromium and WebKit):
 *
 *   prime    open the site in the profile: the seed lands in IndexedDB, the
 *            service worker installs and takes control, Stats is visited.
 *            deploy.sh runs this against the build still serving, before
 *            the swap.
 *   revisit  reopen the same profile: the old worker controls the first load
 *            (recorded), the Library must show its rows, Stats its numbers,
 *            no "taking too long" error, no page error, within a deadline.
 *            deploy.sh runs this after the swap; highdesert-status runs it on
 *            every call (priming first if the profile is missing).
 *
 * It must not count itself: `hd-not-counted` is set before any page script
 * (no view, minute, funnel step or heartbeat, src/services/stats/not-counted.ts),
 * and in Chromium every stats write is also answered at the context, which
 * reaches the worker's fetches too. Nothing here plays audio.
 *
 *   node scripts/returning-visitor.mjs prime|revisit|check --base URL --profile DIR
 *        [--browser chromium|webkit] [--json FILE] [--hold]
 *
 * `--hold` is the control: a second tab of the profile holds a readwrite
 * transaction over `episodes` for the whole revisit (what a frozen Android tab
 * does), and the revisit must then FAIL. A check that cannot fail would pass
 * identically (docs/disconnected-checks.md).
 *
 * `check` = revisit, priming first if DIR holds no primed profile.
 * One line per run on stdout. Exit 0 = ok, 1 = the page failed a returning
 * visitor, 2 = could not run (no browser, site unreachable while priming).
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const SERVER_WRITES = /(\/api\/(stats\/(play|stop|rate|heartbeat|funnel|view)|playback-event)|\/live-api\/tuned)(\?|$)/;
const LIBRARY_DEADLINE_MS = 25_000;
const STATS_DEADLINE_MS = 25_000;
const PRIME_DEADLINE_MS = 90_000;

export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const opts = { mode, browser: "chromium", base: "http://127.0.0.1:3003", profile: null, json: null, hold: false };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    const v = rest[i + 1];
    if (k === "--hold") opts.hold = true;
    else if (["--base", "--profile", "--browser", "--json"].includes(k)) {
      opts[k.slice(2)] = v;
      i++;
    }
  }
  if (!["prime", "revisit", "check"].includes(opts.mode)) throw new Error("mode must be prime, revisit or check");
  if (!["chromium", "webkit"].includes(opts.browser)) throw new Error("--browser must be chromium or webkit");
  if (!opts.profile) throw new Error("--profile DIR is required");
  return opts;
}

/**
 * The verdict on one revisit, from what the page showed. Pure, so
 * scripts/__tests__/returning-visitor.test.ts can hold it to the rule.
 */
/**
 * WebKit reports the unload beacon (`/api/stats/stop`) that a navigation cuts
 * off as a page error ("... due to access control checks") although the app
 * catches it (src/services/stats/client.ts). That is the check navigating, not
 * the page failing; anything else is judged.
 */
export const NAVIGATION_NOISE = /\/api\/stats\/[a-z]+ due to access control checks/;

export function judgeRevisit(r) {
  const problems = [];
  const pageErrors = r.pageErrors.filter((e) => !NAVIGATION_NOISE.test(e));
  if (!r.primed) problems.push("profile was never primed");
  if (r.libraryRows < 1) problems.push(`Library showed no rows within ${LIBRARY_DEADLINE_MS / 1000}s`);
  if (r.libraryTimedOut) problems.push("Library said it was taking too long");
  if (!r.statsShown) problems.push(`Stats showed no numbers within ${STATS_DEADLINE_MS / 1000}s`);
  if (r.statsTimedOut) problems.push("Stats said it was taking too long");
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
  return { ok: problems.length === 0, problems };
}

export function summary(r, verdict) {
  const sw = r.swControlledFirstLoad ? "old worker in control" : "no worker in control";
  const builds = r.primedBuild && r.build && r.primedBuild !== r.build ? `${r.primedBuild} -> ${r.build}` : r.build ?? "?";
  if (!verdict.ok) return `${r.browser}: FAILED (${builds}, ${sw}): ${verdict.problems.join("; ")}`;
  return `${r.browser}: ok (${builds}, ${sw}), Library ${(r.libraryMs / 1000).toFixed(1)}s, Stats ${(r.statsMs / 1000).toFixed(1)}s`;
}

async function launch(browserName, profile) {
  const pw = await import("playwright");
  const type = browserName === "webkit" ? pw.webkit : pw.chromium;
  const context = await type.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1280, height: 860 },
    serviceWorkers: "allow",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("hd-not-counted", "1");
      localStorage.setItem("hd-milestones-seen", "[2,10,100]");
      localStorage.setItem("hd-look-offer", "offered");
    } catch {
      /* storage blocked: the run will say what it saw */
    }
  });
  // Chromium routes the worker's own fetches too; WebKit relies on hd-not-counted.
  await context.route(SERVER_WRITES, (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : route.continue(),
  );
  return context;
}

const rowsOf = (page) => page.locator('[role="listbox"][aria-label="Episodes"] [role="option"]');

async function pageBuild(page) {
  return page.evaluate(() => document.querySelector('meta[name="hd-build"]')?.getAttribute("content") ?? null).catch(() => null);
}

const markerPath = (profile) => path.join(profile, "..", `${path.basename(profile)}.primed.json`);

async function prime(opts) {
  // A failed prime must leave no marker: a revisit would judge a stale profile.
  await rm(markerPath(opts.profile), { force: true });
  await rm(opts.profile, { recursive: true, force: true });
  await mkdir(opts.profile, { recursive: true });
  const context = await launch(opts.browser, opts.profile);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(new URL("/library", opts.base).href, { waitUntil: "load", timeout: PRIME_DEADLINE_MS });
    await rowsOf(page).first().waitFor({ state: "visible", timeout: PRIME_DEADLINE_MS });
    // The whole seed, not its first batch: every row announces the list's size.
    const seed = await (await page.request.get(new URL("/seed/library.json", opts.base).href)).json();
    const deadline = Date.now() + PRIME_DEADLINE_MS;
    for (;;) {
      const n = await page
        .locator('[role="listbox"][aria-label="Episodes"] [role="option"]')
        .first()
        .getAttribute("aria-setsize")
        .catch(() => null);
      if (Number(n) >= seed.length) break;
      if (Date.now() > deadline) throw new Error(`seed reached ${n} of ${seed.length}`);
      await page.waitForTimeout(500);
    }
    // The worker installed and in control: a reload is the first controlled load.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload({ waitUntil: "load" });
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await page.goto(new URL("/stats", opts.base).href, { waitUntil: "load" });
    await page.getByText("Your Listening").first().waitFor({ timeout: PRIME_DEADLINE_MS });
    const build = await pageBuild(page);
    const marker = { primedAt: new Date().toISOString(), base: opts.base, build, controlled, episodes: seed.length };
    await writeFile(markerPath(opts.profile), JSON.stringify(marker));
    return marker;
  } finally {
    await context.close();
  }
}

/** The control's other tab: a raw readwrite transaction over `episodes`, kept alive. */
async function holdDatabase(context, base) {
  const holder = await context.newPage();
  await holder.goto(new URL("/robots.txt", base).href);
  await holder.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("HighDesertDB");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const store = req.result.transaction(["episodes"], "readwrite").objectStore("episodes");
          const spin = () => (store.count().onsuccess = spin);
          spin();
          resolve(true);
        };
      }),
  );
}

async function readMarker(profile) {
  try {
    return JSON.parse(await readFile(markerPath(profile), "utf8"));
  } catch {
    return null;
  }
}

async function revisit(opts) {
  const marker = await readMarker(opts.profile);
  const r = {
    browser: opts.browser,
    primed: !!marker,
    primedBuild: marker?.build ?? null,
    build: null,
    swControlledFirstLoad: false,
    libraryRows: 0,
    libraryMs: 0,
    libraryTimedOut: false,
    statsShown: false,
    statsMs: 0,
    statsTimedOut: false,
    pageErrors: [],
  };
  if (!marker) return r;
  const context = await launch(opts.browser, opts.profile);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (e) => r.pageErrors.push(String(e.message ?? e).slice(0, 160)));
    if (opts.hold) await holdDatabase(context, opts.base);

    const t0 = Date.now();
    await page.goto(new URL("/library", opts.base).href, { waitUntil: "load", timeout: LIBRARY_DEADLINE_MS });
    r.swControlledFirstLoad = await page.evaluate(() => !!navigator.serviceWorker?.controller).catch(() => false);
    const rows = rowsOf(page).first();
    const timeout = page.getByTestId("load-timeout");
    await Promise.race([
      rows.waitFor({ state: "visible", timeout: LIBRARY_DEADLINE_MS }).catch(() => {}),
      timeout.waitFor({ state: "visible", timeout: LIBRARY_DEADLINE_MS }).catch(() => {}),
    ]);
    r.libraryMs = Date.now() - t0;
    r.libraryRows = await rowsOf(page).count();
    r.libraryTimedOut = await timeout.isVisible().catch(() => false);
    r.build = await pageBuild(page);

    const t1 = Date.now();
    await page.goto(new URL("/stats", opts.base).href, { waitUntil: "load", timeout: STATS_DEADLINE_MS });
    const stats = page.getByText("Your Listening").first();
    await Promise.race([
      stats.waitFor({ timeout: STATS_DEADLINE_MS }).catch(() => {}),
      timeout.waitFor({ state: "visible", timeout: STATS_DEADLINE_MS }).catch(() => {}),
    ]);
    r.statsMs = Date.now() - t1;
    r.statsShown = await stats.isVisible().catch(() => false);
    r.statsTimedOut = await timeout.isVisible().catch(() => false);
    return r;
  } finally {
    await context.close();
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.log(`returning-visitor: ${err.message}`);
    process.exit(2);
  }
  const write = async (obj) => {
    if (opts.json) await writeFile(opts.json, JSON.stringify({ at: new Date().toISOString(), ...obj }, null, 2));
  };
  try {
    if (opts.mode === "prime" || (opts.mode === "check" && !(await readMarker(opts.profile)))) {
      const m = await prime(opts);
      if (opts.mode === "prime") {
        console.log(`${opts.browser}: primed on ${m.build ?? "?"} (${m.episodes} episodes, worker ${m.controlled ? "in control" : "not in control"})`);
        await write({ mode: "prime", browser: opts.browser, ok: true, ...m });
        process.exit(0);
      }
    }
  } catch (err) {
    console.log(`${opts.browser}: could not prime: ${String(err.message ?? err).split("\n")[0]}`);
    await write({ mode: "prime", browser: opts.browser, ok: false, error: String(err.message ?? err) });
    process.exit(2);
  }
  if (!(await readMarker(opts.profile))) {
    // Nothing primed (the prime could not run): not judged, never a failure.
    console.log(`${opts.browser}: not primed, nothing to revisit`);
    await write({ mode: "revisit", browser: opts.browser, ok: false, error: "not primed" });
    process.exit(2);
  }
  try {
    const r = await revisit(opts);
    const verdict = judgeRevisit(r);
    console.log(summary(r, verdict));
    await write({ mode: "revisit", ...r, ok: verdict.ok, problems: verdict.problems });
    process.exit(verdict.ok ? 0 : 1);
  } catch (err) {
    console.log(`${opts.browser}: could not run: ${String(err.message ?? err).split("\n")[0]}`);
    await write({ mode: "revisit", browser: opts.browser, ok: false, error: String(err.message ?? err) });
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
