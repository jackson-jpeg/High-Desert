#!/usr/bin/env node
/**
 * Do the live site's presence surfaces agree? `highdesert-status` runs this.
 *
 * One screen once read 7 online on the Stats badge, 8 in the status bar and 10
 * in On Air. Every surface now renders one shared snapshot and tags the element
 * that shows the number with `data-presence`, `data-online`, `data-listening`
 * and `data-presence-poll` (`presenceAttrs()` in src/services/stats/now-feed.ts).
 * This loads the real site in headless Chromium and reads them:
 *
 *   desktop /library  — the Stats tab badge and the status bar
 *   desktop /stats    — the status bar, On Air and Signal Traffic
 *   mobile  /stats    — On Air, Signal Traffic and the menu sheet (opened)
 *
 * Within one page, surfaces that report the same poll must show the same
 * numbers, in their attributes **and** in their visible text. Surfaces caught
 * mid-update (different polls) are re-read, not judged.
 *
 * It must not change what it measures: every stats write is answered inside
 * the page and the service worker is blocked (its fetches bypass routing), so
 * this browser never sends a heartbeat and is never counted as present. With
 * nobody else on the site the surfaces render nothing, and that is reported as
 * OK with nothing to compare, not as a failure.
 *
 *   node scripts/presence-check.mjs [https://highdesert.space]
 *
 * Prints one line. Exit 0 = agree (or nothing to compare), 1 = disagree or
 * surfaces missing while /api/stats/now reports people online, 2 = could not run.
 */

const SERVER_WRITES = /\/api\/(stats\/(play|stop|rate|heartbeat)|playback-event)(\?|$)/;
const REREADS = 6;

/**
 * Judge one page's surfaces. Pure, so scripts/__tests__/presence-check.test.ts
 * can hold it to the rule without a browser.
 *
 * @param {{surface: string, online: number, listening: number, poll: string, shown: number[]}[]} surfaces
 * @returns {{verdict: "agree" | "disagree" | "mid-update" | "empty", detail: string}}
 */
export function judgeSurfaces(surfaces) {
  if (surfaces.length === 0) return { verdict: "empty", detail: "no presence surfaces rendered" };
  const polls = new Set(surfaces.map((s) => s.poll));
  if (polls.size > 1) return { verdict: "mid-update", detail: `polls ${[...polls].join(",")}` };

  const problems = [];
  const first = surfaces[0];
  for (const s of surfaces) {
    if (s.online !== first.online || s.listening !== first.listening) {
      problems.push(`${s.surface} says ${s.online}/${s.listening}, ${first.surface} says ${first.online}/${first.listening}`);
    }
    // What a listener reads: the badge shows online only; the rest show both.
    const expected = s.surface === "badge" ? [s.online] : [s.online, s.listening];
    const shown = s.shown.slice(0, expected.length);
    if (shown.length !== expected.length || shown.some((n, i) => n !== expected[i])) {
      problems.push(`${s.surface} displays ${JSON.stringify(s.shown)} but is tagged ${s.online}/${s.listening}`);
    }
  }
  if (problems.length) return { verdict: "disagree", detail: problems.join("; ") };
  return {
    verdict: "agree",
    detail: `${surfaces.map((s) => s.surface).join(", ")} = ${first.online} online / ${first.listening} listening`,
  };
}

async function readSurfaces(page) {
  return page.$$eval("[data-presence]", (els) =>
    els.map((el) => {
      const online = Number(el.getAttribute("data-online"));
      const listening = Number(el.getAttribute("data-listening"));
      // Only the numbers the listener reads; "listening" alone is omitted when
      // zero on some surfaces, which the judge accounts for below.
      const shown = (el.textContent ?? "").match(/\d+/g)?.map(Number) ?? [];
      return {
        surface: el.getAttribute("data-presence") ?? "?",
        online,
        listening,
        poll: el.getAttribute("data-presence-poll") ?? "?",
        shown: listening === 0 && shown.length === 1 ? [...shown, 0] : shown,
      };
    }),
  );
}

async function main() {
  const base = (process.argv[2] ?? "https://highdesert.space").replace(/\/$/, "");
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    console.log(`could not load playwright: ${err.message}`);
    process.exit(2);
  }

  const nowRes = await fetch(`${base}/api/stats/now`).catch(() => null);
  const now = nowRes?.ok ? await nowRes.json().catch(() => null) : null;
  if (!now) {
    console.log(`could not read ${base}/api/stats/now`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const results = [];
  try {
    const views = [
      { name: "desktop /library", path: "/library", viewport: { width: 1280, height: 800 } },
      { name: "desktop /stats", path: "/stats", viewport: { width: 1280, height: 800 } },
      { name: "mobile /stats", path: "/stats", viewport: { width: 390, height: 844 }, openSheet: true },
    ];
    for (const view of views) {
      const context = await browser.newContext({
        viewport: view.viewport,
        serviceWorkers: "block",
        isMobile: !!view.openSheet,
        hasTouch: !!view.openSheet,
      });
      const page = await context.newPage();
      await page.route(SERVER_WRITES, (route) =>
        route.request().method() === "POST" ? route.fulfill({ json: { ok: true } }) : route.fallback(),
      );
      await page.goto(base + view.path, { waitUntil: "load", timeout: 30_000 });
      await page
        .waitForSelector("[data-presence-poll]:not([data-presence-poll='0'])", { timeout: 15_000 })
        .catch(() => {});
      if (view.openSheet) {
        await page.locator('button[aria-label="More options"]').click({ timeout: 5_000 }).catch(() => {});
        await page.waitForSelector('[data-presence="mobile-sheet"]', { timeout: 5_000 }).catch(() => {});
      }

      let judged = { verdict: "empty", detail: "" };
      for (let i = 0; i < REREADS; i++) {
        judged = judgeSurfaces(await readSurfaces(page));
        if (judged.verdict !== "mid-update") break;
        await page.waitForTimeout(500);
      }
      results.push({ view: view.name, ...judged });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const bad = results.filter((r) => r.verdict === "disagree" || r.verdict === "mid-update");
  // Surfaces absent while the API says people are here means the tagging (or
  // the surfaces) went missing — the check would otherwise go quietly blind.
  // All views, not any: one person leaving between the API read and a page
  // load legitimately empties a view, and that must not read as a failure.
  const blind = now.online > 1 && results.every((r) => r.verdict === "empty") ? results : [];
  if (bad.length || blind.length) {
    console.log(
      [...bad, ...blind.map((r) => ({ ...r, detail: `no tagged surfaces while /api/stats/now says ${now.online} online` }))]
        .map((r) => `${r.view}: ${r.detail}`)
        .join(" | "),
    );
    process.exit(1);
  }
  const agreed = results.filter((r) => r.verdict === "agree");
  console.log(
    agreed.length
      ? `surfaces agree in ${agreed.length} view(s): ${agreed.map((r) => `${r.view} (${r.detail})`).join("; ")}`
      : "nobody else online — nothing to compare",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.log(`presence check crashed: ${err.message}`);
    process.exit(2);
  });
}
