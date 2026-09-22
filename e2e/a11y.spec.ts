/**
 * axe-core on the three public pages, at both sizes (HD-021/022/023).
 *
 * Fails on any **serious** or **critical** violation. Moderate and minor
 * findings are printed, not failed: they are worth reading, but a rule this
 * broad that failed on every one of them would be switched off within a week,
 * and an assertion nobody runs observes nothing.
 *
 * Each page is scanned once it has *settled*: the boot screen gone, the
 * layout hydrated, the page's own content rendered, and every finite CSS
 * animation finished. axe measures contrast on what is painted at the instant
 * it runs, and a row caught halfway through `animate-fade-in` reads as a
 * contrast failure it is not — and then stayed quiet for a moment, since
 * some content fades in late on its own timer. Infinite animations (the
 * on-air pulse) are left running; they never finish and are not text.
 *
 * Anything excluded is excluded here, by selector, with its reason — and
 * listed in docs/a11y-exceptions.md. There is nothing in that list today.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { openLibrary } from "./library";

/** Selectors axe skips, each with a line in docs/a11y-exceptions.md. */
const EXCLUDED: string[] = [];

async function settled(page: Page): Promise<void> {
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("[data-hydrated]").first()).toBeAttached({ timeout: 30_000 });
  // Quiet means no finite animation running *and* none starting over the
  // next 1.5s: some content arrives late on its own timer — the radio's
  // first-visit hint fades in ~800ms after the station index, and axe caught
  // it mid-fade once, reporting its amber text at 3.9:1.
  await page.evaluate(async () => {
    const running = () =>
      document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
    for (let i = 0; i < 10; i++) {
      await Promise.all(running().map((a) => a.finished.catch(() => undefined)));
      await new Promise((r) => setTimeout(r, 1500));
      if (running().length === 0) break;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function scan(page: Page, route: string) {
  let builder = new AxeBuilder({ page });
  for (const sel of EXCLUDED) builder = builder.exclude(sel);
  const { violations } = await builder.analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const describe = (vs: typeof violations) =>
    vs
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.help}\n` +
          v.nodes
            .slice(0, 8)
            .map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.split("\n").join("\n      ")}`)
            .join("\n"),
      )
      .join("\n");
  const advisory = violations.filter((v) => !blocking.includes(v));
  if (advisory.length) console.log(`axe ${route} (advisory, not failed):\n${describe(advisory)}`);
  expect(blocking, `axe ${route}: serious/critical violations\n${describe(blocking)}`).toEqual([]);
}

test("/library has no serious or critical axe violations", async ({ page }) => {
  await openLibrary(page);
  await settled(page);
  await scan(page, "/library");
});

test("/library with its modal open (palette on desktop, menu sheet on a phone) has no serious or critical axe violations", async ({ page, isMobile }) => {
  await openLibrary(page);
  await settled(page);
  if (isMobile) {
    await page.getByRole("button", { name: "More options" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  } else {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  }
  await settled(page);
  await scan(page, isMobile ? "/library + menu sheet" : "/library + command palette");
});

test("/radio has no serious or critical axe violations", async ({ page }) => {
  // Seeds the catalog in this profile first: the dial has no stations to show
  // until the library exists, and an empty dial is not the page people use.
  await openLibrary(page);
  await page.goto("/radio");
  await expect(page.getByRole("tablist", { name: "Jump to year" })).toBeVisible({ timeout: 45_000 });
  // A first visit shows the tuning hint, ~800ms after the dial is ready. Wait
  // for it, so it is scanned every run at full opacity — not sometimes, and
  // not halfway through its fade-in.
  await expect(page.getByText(/Drag the dial to tune/).first()).toBeVisible({ timeout: 15_000 });
  await settled(page);
  await scan(page, "/radio");
});

test("/stats has no serious or critical axe violations", async ({ page }) => {
  await openLibrary(page);
  await page.goto("/stats");
  await settled(page);
  // The page is built from the catalog in IndexedDB; wait until a figure from
  // it has rendered rather than scanning the empty frame.
  await expect(page.getByText(/episodes/i).first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await scan(page, "/stats");
});
