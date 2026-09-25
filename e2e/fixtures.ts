/**
 * The `test` every spec imports. Two things, for every test, automatically:
 *
 * 1. **Nothing a test does is written to the server.** Starting a show posts
 *    `/api/stats/play`, and a play lands in `play_events`, which is never
 *    pruned — and this harness may be pointed at production
 *    (playwright.config.ts). A first run of the intent specs left twelve plays
 *    in a database and broke an unrelated test. So every stats write, and the
 *    failure report a stalled stream would send, is answered in the page with
 *    `{ok: true}`; reads (GET) still reach the server.
 *
 * 2. **The service worker is blocked.** Its fetches bypass `page.route()`:
 *    with it registered, the route above sat idle and every play still reached
 *    the server. No spec here tests the worker.
 *
 * `serverWrites` lists what was intercepted, so a spec that starts playback
 * can assert its write was caught — an idle interception would otherwise pass
 * silently (docs/disconnected-checks.md).
 *
 * 3. **Each test is its own client.** The stats *reads* still reach the server,
 *    and they are rate limited per client (`src/lib/utils/rate-limit.ts`),
 *    where a client is the address nginx puts in `X-Forwarded-For`. Nothing
 *    sets that header in CI, so every request from every parallel worker shared
 *    the one "unknown" bucket and the suite as a whole blew through
 *    `/api/stats/ratings`'s 30/min — leaving the detail panel re-rendering
 *    around a 429 until the test timed out. A distinct address per test is the
 *    shape production actually has (one visitor, one bucket) and keeps the real
 *    limiter in the path instead of stubbing the reads out.
 *
 * `busEventName` is the bus's transport name for a key, from src/lib/events.ts
 * itself. Specs run code in the page, outside the bundle, so they listen by
 * name; importing the name rather than spelling `hd:*` keeps it one definition.
 */
import { test as base, expect } from "@playwright/test";
import { hdEventName } from "../src/lib/events";

export const busEventName = hdEventName;

const SERVER_WRITES = /\/api\/(stats\/(play|stop|rate|heartbeat)|playback-event)(\?|$)/;

/**
 * A private-range address unique to this test within the run. 10/8 has room for
 * every test a run can produce, and the app only ever uses it as an opaque
 * bucket key.
 */
let clientSeq = 0;
function nextClientAddress(workerIndex: number): string {
  const n = (workerIndex << 12) + (clientSeq++ & 0xfff);
  return `10.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${(n & 0xff) || 1}`;
}

/**
 * Answer every stats write in `page` in the page itself, recording each in
 * `seen`. The `serverWrites` fixture does this for the test's own page; a spec
 * that opens a second context (e2e/live.spec.ts) calls it for that one too.
 */
export async function answerServerWrites(page: import("@playwright/test").Page, seen: string[]): Promise<void> {
  await page.route(SERVER_WRITES, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    seen.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { ok: true } });
  });
}

/** A fresh, distinct client address for a second context in the same test. */
export function anotherClientAddress(workerIndex: number): string {
  return nextClientAddress(workerIndex);
}

export const test = base.extend<{ serverWrites: string[] }>({
  serviceWorkers: "block",
  // `provide` is Playwright's `use`; the name is deliberate — react-hooks reads
  // a bare `use()` inside a function named for the option as a React hook call.
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    await provide({ "x-forwarded-for": nextClientAddress(testInfo.workerIndex) });
  },
  serverWrites: [
    async ({ page }, use) => {
      const seen: string[] = [];
      await answerServerWrites(page, seen);
      await use(seen);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator } from "@playwright/test";
