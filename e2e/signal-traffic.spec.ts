import { test, expect } from "./fixtures";

/**
 * Signal Traffic's scale label must never cover the data.
 *
 * The label naming the top of the scale sat absolutely positioned in the
 * plot's top-left corner, which is exactly where the first point lands
 * whenever the window opens on its busiest bucket. On 2026-09-25 the 30-day
 * chart drew its "10" on top of its own first point. The label now lives in a
 * row above the plot; this measures it in a real layout, on desktop and at
 * 390 wide, with /api/stats/traffic answered in the page so the first point is
 * the peak — the case that collided.
 */

const DAY = 86_400_000;

function traffic(range: string) {
  const now = Date.now();
  const n = 120;
  const step = (30 * DAY) / n;
  return {
    range,
    points: Array.from({ length: n }, (_, i) => ({
      t: new Date(now - (n - i) * step).toISOString(),
      online: i === 0 ? 6 : 2,
      listening: 1,
      onlineMax: i === 0 ? 10 : 3,
      listeningMax: i === 0 ? 7 : 1,
      plays: i % 7 === 0 ? 2 : 0,
    })),
    peakOnline: 10,
    peakListening: 7,
    playsInRange: 34,
    totalPlays: 1000,
    peakAt: new Date(now - n * step).toISOString(),
    hourly: [],
    playsBySource: {},
  };
}

test("the scale label sits outside the plot and clear of the first point", async ({ page }) => {
  await page.route("**/api/stats/traffic?*", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "24h";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(traffic(range)) });
  });
  await page.goto("/stats");
  const panel = page.locator("#traffic");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: /30 days|30d/ }).click();
  await expect(panel.getByRole("button", { name: /30 days|30d/ })).toHaveAttribute("aria-pressed", "true");

  const label = panel.getByTestId("traffic-scale-top");
  await expect(label).toHaveText("10");
  const plot = panel.locator('[role="img"]');

  const m = await page.evaluate(() => {
    const svg = document.querySelector("#traffic [role='img'] svg") as SVGSVGElement;
    const path = svg.querySelector('path[data-series="online-max"]') as SVGPathElement;
    const lbl = document.querySelector("[data-testid='traffic-scale-top']") as HTMLElement;
    const r = svg.getBoundingClientRect();
    const [x, y] = path.getAttribute("d")!.split(" ")[0].slice(1).split(",").map(Number);
    const vb = svg.viewBox.baseVal;
    const l = lbl.getBoundingClientRect();
    return {
      point: { x: r.left + (x / vb.width) * r.width, y: r.top + (y / vb.height) * r.height },
      plotTop: r.top,
      label: { left: l.left, right: l.right, top: l.top, bottom: l.bottom },
    };
  });
  const plotBox = await plot.boundingBox();
  expect(plotBox).not.toBeNull();

  // The first point is the peak, so it sits at the very top-left of the plot.
  expect(m.point.x - plotBox!.x).toBeLessThan(4);
  expect(m.point.y - m.plotTop).toBeLessThan(12);
  // The label ends above the plot, so no point can be under it...
  expect(m.label.bottom).toBeLessThanOrEqual(plotBox!.y + 0.5);
  // ...and specifically not the first one (a 6px disc around it).
  const clear =
    m.label.right < m.point.x - 6 || m.label.left > m.point.x + 6 || m.label.bottom < m.point.y - 6 || m.label.top > m.point.y + 6;
  expect(clear, JSON.stringify(m)).toBe(true);
});
