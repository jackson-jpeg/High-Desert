import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "./fixtures";

/**
 * The Live screen says it once (2026-10-12). On a phone the hero at the top
 * is the only place for ON AIR, the show on the air and Listen live; under
 * it, one strip (the station clock in PT, and what is next with its start
 * time), then Tonight's log, whose on-air row is a marker. Before, a Studio
 * window under the hero repeated the ON AIR lamp, and its log repeated the
 * lamp and the title. Desktop keeps its console (no hero, so nothing doubled).
 *
 * Both looks; phones are the `mobile` project (and `iphone`, WebKit, with
 * E2E_WEBKIT=1); desktop is `desktop`. Screenshots go to
 * test-results/live-phone/<project>-<look>.png for a person to look at; they
 * are evidence, not pixel baselines (see e2e/looks.spec.ts).
 */

const LOOKS = ["win98", "night"] as const;
type Look = (typeof LOOKS)[number];
const OUT = "test-results/live-phone";
mkdirSync(OUT, { recursive: true });

async function enterLook(page: Page, baseURL: string, look: Look): Promise<void> {
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
}

/** The top of each part of the phone's Live column, or null when it is not drawn. */
function tops(page: Page): Promise<Record<string, number | null>> {
  return page.evaluate(() => {
    const top = (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? Math.round(r.top + window.scrollY) : null;
    };
    return {
      hero: top("live-hero"),
      callIn: top("live-call-in"),
      strip: top("live-strip"),
      log: top("live-log"),
    };
  });
}

for (const look of LOOKS) {
  test.describe(`Live, ${look}`, () => {
    test.beforeEach(async ({ page, baseURL }) => {
      await enterLook(page, baseURL!, look);
    });

    test("a phone: the hero first and the only ON AIR, then the strip, then Tonight's log", async ({ page }, info) => {
      test.skip(!info.project.use.isMobile, "a phone's Live screen");
      await page.goto("/live");
      const hero = page.getByTestId("live-hero");
      await expect(hero).toBeVisible({ timeout: 45_000 });
      await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId("live-strip")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}.png`, fullPage: true });

      // ON AIR once, in the hero: the lamp's words as drawn, across the station's
      // own parts (not the callers' preview, whose words are anyone's).
      const onAir = await page.evaluate(() =>
        ["live-hero", "live-strip", "live-log"]
          .map((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.innerText ?? "")
          .join("\n")
          .match(/on air/gi)?.length ?? 0,
      );
      expect(onAir, "ON AIR on the Live screen").toBe(1);
      await expect(page.locator("[data-on-air]:visible")).toHaveCount(1);
      await expect(hero.locator("[data-on-air]")).toHaveCount(1);
      // The show on the air is named once: the hero's title, not again in the log.
      await expect(page.getByTestId("live-now-title")).toHaveCount(1);
      await expect(page.getByTestId("live-guide").locator('li[aria-current="true"]')).toHaveText(/On the air now/i);

      // The strip: the clock (PT) and what is next, one row.
      const strip = page.getByTestId("live-strip");
      await expect(strip.getByTestId("live-clock")).toHaveText(/\d{1,2}:\d{2}/);
      await expect(strip).toContainText("PT");
      await expect(strip).toContainText(/Up next \d{1,2}:\d{2}|The last show of the day/);
      const h = await strip.evaluate((el) => el.getBoundingClientRect().height);
      expect(h, "the strip is one row").toBeLessThanOrEqual(64);
      const over = await strip.evaluate((el) => el.getBoundingClientRect().right - document.documentElement.clientWidth);
      expect(over, "the strip fits the screen").toBeLessThanOrEqual(1);

      // Top down: the hero, then (Call in, the calls, the install card), the strip, the log.
      const t = await tops(page);
      expect(t.hero, "the hero").not.toBeNull();
      for (const [part, y] of Object.entries(t)) if (part !== "hero" && y !== null) expect(y, `${part} under the hero`).toBeGreaterThan(t.hero!);
      expect(t.strip!, "the strip under Call in").toBeGreaterThan(t.callIn!);
      expect(t.log!, "Tonight's log under the strip").toBeGreaterThan(t.strip!);
      await expect(page.getByTestId("live-log").getByRole("heading", { name: /Tonight's log/i })).toBeVisible();
    });

    test("desktop: the console is unchanged, with its clock, up next and the log", async ({ page }, info) => {
      test.skip(!!info.project.use.isMobile, "the desktop studio");
      await page.goto("/live");
      await expect(page.getByTestId("live-now")).toBeVisible({ timeout: 45_000 });
      await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}.png` });
      await expect(page.getByTestId("live-hero")).toHaveCount(0);
      await expect(page.getByTestId("live-strip")).toHaveCount(0);
      await expect(page.getByTestId("live-clock")).toBeVisible();
      await expect(page.getByTestId("live-log")).toBeVisible();
    });
  });
}
