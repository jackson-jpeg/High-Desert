import { test, expect } from "./fixtures";

/**
 * The arrival funnel from a real browser (docs/funnel.md): a first visit
 * straight to /live — the way the Reddit launch arrived — reports the arrival
 * and the Live screen once each, and a reload reports nothing again. The POSTs
 * are answered in the page (as the fixture does for every stats write), so
 * nothing reaches the server's counters.
 */

test("a first visit to /live is one arrival and one 'saw Live', and a reload adds neither", async ({ page }) => {
  const posts: { step: string; cohort: string }[] = [];
  await page.route(/\/api\/stats\/funnel(\?|$)/, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto("/live");
  const cohort = new Date().toISOString().slice(0, 10);
  await expect.poll(() => posts.map((p) => p.step).sort(), { timeout: 20_000 }).toEqual(["live", "visit"]);
  expect(posts.every((p) => p.cohort === cohort)).toBe(true);

  await page.reload();
  await expect(page.getByTestId("live-now-title").or(page.getByText("Warming up the transmitter"))).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(posts).toHaveLength(2);
});
