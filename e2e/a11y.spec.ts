/**
 * axe-core on every page, at both sizes (HD-021/022/023).
 *
 * Fails on any **moderate**, **serious** or **critical** violation. Minor
 * findings are printed, not failed. The gate used to stop at serious, which
 * left `page-has-heading-one` reported on every run for months and fixed on
 * none: an advisory line nobody acts on observes nothing either. Moderate is
 * where axe puts the structural rules — one h1, landmarks, heading order —
 * and those are cheap to hold once they are clean.
 *
 * Also asserts every route has exactly one h1, with its expected text, which
 * axe does not: `page-has-heading-one` passes a page with three.
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

/** The impacts that fail a scan. Minor is printed only. */
const BLOCKING = ["moderate", "serious", "critical"];

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

/** Admin mode, as the password gate leaves it (src/stores/admin-store.ts). */
async function asAdmin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("hd-admin", "1");
    } catch {
      /* storage blocked: the admin pages redirect, and the test says so */
    }
  });
}

async function scan(page: Page, route: string) {
  let builder = new AxeBuilder({ page });
  for (const sel of EXCLUDED) builder = builder.exclude(sel);
  const { violations } = await builder.analyze();
  const blocking = violations.filter((v) => BLOCKING.includes(v.impact ?? ""));
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
  expect(blocking, `axe ${route}: moderate/serious/critical violations\n${describe(blocking)}`).toEqual([]);
}

test("/library has no moderate, serious or critical axe violations", async ({ page }) => {
  await openLibrary(page);
  await settled(page);
  await scan(page, "/library");
});

test("/library with its modal open (palette on desktop, menu sheet on a phone) has no moderate, serious or critical axe violations", async ({ page, isMobile }) => {
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

test("/radio has no moderate, serious or critical axe violations", async ({ page }) => {
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

test("/stats has no moderate, serious or critical axe violations", async ({ page }) => {
  await openLibrary(page);
  await page.goto("/stats");
  await settled(page);
  // The page is built from the catalog in IndexedDB; wait until a figure from
  // it has rendered rather than scanning the empty frame.
  await expect(page.getByText(/episodes/i).first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await scan(page, "/stats");
});

// The welcome page is only ever seen on a first visit (a returning visitor is
// sent straight to /library), which is what every test's fresh profile is.
test("/ (the welcome page) has no moderate, serious or critical axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "HIGH DESERT" })).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await scan(page, "/");
});

// The admin pages. Reached the way an admin reaches them — the nav tab from
// /library — since the password gate is UI only and their content is the same
// for anyone who flips it.
for (const [route, tab, heading] of [
  ["/scanner", "Scanner", "Import Sources"],
  ["/search", "Search", "Search Archive.org"],
] as const) {
  test(`${route} (admin) has no moderate, serious or critical axe violations`, async ({ page }) => {
    await asAdmin(page);
    await openLibrary(page);
    await page.getByRole("navigation").getByRole("button", { name: tab, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeAttached({ timeout: 30_000 });
    await settled(page);
    await scan(page, route);
  });
}

/**
 * Exactly one h1 on every route, and the right one. Checked with the page
 * settled *and* its content rendered: /stats's loading window and its
 * populated page are different trees, and it was only the populated one that
 * had no h1. src/app/__tests__/route-headings.test.tsx holds the same line
 * under vitest, where it can be mutation-checked.
 */
const HEADINGS: { route: string; h1: string; admin?: boolean; seed?: boolean; loaded?: (page: Page) => Promise<void> }[] = [
  { route: "/", h1: "HIGH DESERT" },
  { route: "/library", h1: "Library", seed: true },
  {
    route: "/radio",
    h1: "Radio Dial",
    seed: true,
    loaded: (page) => expect(page.getByRole("tablist", { name: "Jump to year" })).toBeVisible({ timeout: 45_000 }),
  },
  {
    route: "/stats",
    h1: "Station Dashboard",
    seed: true,
    loaded: (page) => expect(page.getByRole("heading", { name: "Your Listening" })).toBeVisible({ timeout: 30_000 }),
  },
  { route: "/scanner", h1: "Import Sources", admin: true, seed: true },
  { route: "/search", h1: "Search Archive.org", admin: true, seed: true },
  { route: "/no-such-frequency", h1: "Signal Lost" },
];

for (const { route, h1, admin, seed, loaded } of HEADINGS) {
  test(`${route} has exactly one h1: "${h1}"`, async ({ page }) => {
    if (admin) await asAdmin(page);
    if (seed) await openLibrary(page);
    if (route !== "/library") {
      if (admin) {
        const tab = route === "/scanner" ? "Scanner" : "Search";
        await page.getByRole("navigation").getByRole("button", { name: tab, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${route}$`));
      } else {
        await page.goto(route);
      }
    }
    await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
    await loaded?.(page);
    // toHaveText with an array is a count assertion too: one element, this text.
    await expect(page.locator("h1")).toHaveText([h1]);
  });
}
