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
 * `busEventName` is the bus's transport name for a key, from src/lib/events.ts
 * itself. Specs run code in the page, outside the bundle, so they listen by
 * name; importing the name rather than spelling `hd:*` keeps it one definition.
 */
import { test as base, expect } from "@playwright/test";
import { hdEventName } from "../src/lib/events";

export const busEventName = hdEventName;

const SERVER_WRITES = /\/api\/(stats\/(play|stop|rate|heartbeat)|playback-event)(\?|$)/;

export const test = base.extend<{ serverWrites: string[] }>({
  serviceWorkers: "block",
  serverWrites: [
    async ({ page }, use) => {
      const seen: string[] = [];
      await page.route(SERVER_WRITES, (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        seen.push(new URL(route.request().url()).pathname);
        return route.fulfill({ json: { ok: true } });
      });
      await use(seen);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator } from "@playwright/test";
