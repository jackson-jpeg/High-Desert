import { test, expect, type Page } from "./fixtures";
import { mkdirSync } from "node:fs";
import { openLibrary, episodeList } from "./library";
import { playFromFixtureMirror } from "./fixture-audio";

/**
 * Every user-facing screen, in both looks, on a phone and a desktop
 * (docs/looks.md). Each screen is saved to test-results/looks/ (CI uploads
 * it as the `look-screenshots` artifact on every run, pass or fail), and held
 * to what a look must never do:
 *
 *   - the page is in the look it was asked for, from the server's first byte
 *     (`<html data-look>` in the HTML itself, not set by script);
 *   - no uncaught page error;
 *   - nothing wider than a phone's screen;
 *   - no em dash in any text on screen (CLAUDE.md).
 *
 * A look is chosen the way a visitor's device remembers it: the `hd_look`
 * cookie (src/lib/look/look.ts). Win98 is what no cookie gets.
 *
 * Screenshots are evidence for a person comparing looks, not pixel baselines:
 * fonts and the live schedule differ between machines and minutes, and a
 * baseline that fails on a clock would be read past.
 */

const LOOKS = ["win98", "night"] as const;
type Look = (typeof LOOKS)[number];

const SHOW = "/show/1992-12-12-area-51-john-lear-bob-lazar";
const GUEST = "/guest/linda-moulton-howe";
const TOPIC = "/topic/mels-hole";
const OUT = "test-results/looks";
mkdirSync(OUT, { recursive: true });

async function enterLook(page: Page, baseURL: string, look: Look): Promise<void> {
  if (look === "win98") return; // the default: no cookie at all
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 }).catch(() => {});
  // The page transition fades a route in: wait for its content, then let the
  // look's components swap in after hydration.
  await page
    .waitForFunction(() => {
      const main = document.querySelector("#hd-main") as HTMLElement | null;
      return !main || main.innerText.trim().length > 40;
    }, undefined, { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(1_000);
}

async function checkScreen(page: Page, look: Look, name: string, project: string, errors: string[]): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${project}-${look}-${name}.png` });
  const state = await page.evaluate(() => ({
    look: document.documentElement.getAttribute("data-look"),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    text: document.body.innerText,
  }));
  expect(state.look, `${name}: the look must be on`).toBe(look);
  expect(state.text.includes("\u2014"), `${name}: an em dash on screen in ${look}`).toBe(false);
  expect(state.overflow, `${name}: wider than the screen`).toBeLessThanOrEqual(1);
  expect(errors, `${name}: page errors`).toEqual([]);
}

for (const look of LOOKS) {
  test.describe(`look: ${look}`, () => {
    let errors: string[];
    test.beforeEach(async ({ page, baseURL }) => {
      errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await enterLook(page, baseURL!, look);
    });

    test("the server renders the look: no flash of the other one", async ({ page }) => {
      const res = await page.request.get("/library", {
        headers: look === "win98" ? {} : { cookie: `hd_look=${look}` },
      });
      expect(await res.text()).toContain(`<html lang="en" data-look="${look}"`);
    });

    test("welcome, stats, live, show, guest and not-found pages", async ({ page }, info) => {
      const project = info.project.name;
      const screens: [string, string][] = [
        ["welcome", "/"],
        ["stats", "/stats"],
        ["live", "/live"],
        ["show", SHOW],
        ["show-moment", `${SHOW}?t=5025`],
        ["guest", GUEST],
        ["topics", "/topics"],
        ["topic", TOPIC],
        ["tonight", "/tonight"],
        ["not-found", "/no-such-page-here"],
      ];
      for (const [name, path] of screens) {
        await page.goto(path);
        if (name !== "not-found" && name !== "welcome" && name !== "stats" && name !== "live") {
          await expect(page.locator("h1").first()).toBeVisible();
        }
        await checkScreen(page, look, name, project, errors);
      }
    });

    test("nothing playing: the player offers the station", async ({ page }, info) => {
      await openLibrary(page);
      await expect(page.getByTestId("player-empty").first()).toBeVisible({ timeout: 20_000 });
      await checkScreen(page, look, "player-empty", info.project.name, errors);
    });

    test("the Display setting", async ({ page, isMobile }, info) => {
      await openLibrary(page);
      await settle(page);
      if (look === "win98") {
        // Start > Settings > Display...
        await page.getByTestId("w98-start").click();
        await page.getByTestId("w98-start-settings").click();
        await page.getByTestId("w98-start-display").click();
        await expect(page.getByTestId("w98-display")).toBeVisible();
      } else if (isMobile) {
        // More > Display
        await page.getByRole("button", { name: "More options" }).click();
        await page.getByTestId("more-display").click();
        await expect(page.getByTestId("night-display")).toBeVisible();
      } else {
        // View > Display...
        await page.getByRole("menuitem", { name: "View" }).click();
        await page.getByRole("menuitem", { name: "Display..." }).click();
        await expect(page.getByTestId("night-display")).toBeVisible();
      }
      await checkScreen(page, look, "display", info.project.name, errors);
    });

    test("library, its detail panel, and the dial", async ({ page }, info) => {
      const project = info.project.name;
      await openLibrary(page);
      await checkScreen(page, look, "library", project, errors);

      await episodeList(page).locator('[role="option"]').first().click();
      await checkScreen(page, look, "library-detail", project, errors);

      await page.goto("/library?view=dial");
      await expect(page.getByTestId("library-dial")).toBeVisible({ timeout: 45_000 });
      await checkScreen(page, look, "library-dial", project, errors);
      // /radio is the dial in both looks.
      await page.goto("/radio");
      await expect(page).toHaveURL(/\/library\?view=dial|\/library$/);
    });

    test("the player, small and expanded", async ({ page, isMobile }, info) => {
      const project = info.project.name;
      await playFromFixtureMirror(page);
      if (isMobile) {
        // A phone starts audio the way most phones do: Listen live (docs/funnel.md).
        await page.goto("/live");
        await settle(page);
        await page.getByTestId("live-tune-in").click();
      } else {
        await openLibrary(page);
        await episodeList(page).locator('[role="option"]').first().dblclick();
      }
      const player = look === "win98" ? page.getByTestId("w98-amp").first() : page.locator("[data-player]").first();
      await expect(player).toBeVisible({ timeout: 20_000 });
      await checkScreen(page, look, "player", project, errors);
      const expand = look === "win98"
        ? page.getByTestId("w98-amp-expand").first()
        : page.getByRole("button", { name: "Expand player" }).first();
      if (await expand.isVisible().catch(() => false)) {
        await expand.click();
        await checkScreen(page, look, "player-expanded", project, errors);
      }
    });

    test("the phone lines", async ({ page, isMobile }, info) => {
      await page.goto("/live");
      await settle(page);
      if (isMobile) {
        // On a phone the lines are a sheet behind the Call in button.
        const callIn = page.getByTestId("live-call-in");
        if (await callIn.isVisible().catch(() => false)) await callIn.click();
      }
      await expect(page.getByTestId("phone-lines").first()).toBeVisible({ timeout: 20_000 });
      await checkScreen(page, look, "phone-lines", info.project.name, errors);
    });

    if (look === "win98") {
      test("win98: the first-visit Night offer", async ({ page }, info) => {
        // The fixture marks the offer as made in every context; this one is a
        // first visit with no record.
        await page.addInitScript(() => {
          try {
            if (localStorage.getItem("hd-look-offer") === "e2e") localStorage.removeItem("hd-look-offer");
          } catch {
            /* storage blocked: nothing to undo */
          }
        });
        await openLibrary(page);
        await expect(page.getByTestId("night-offer")).toBeVisible({ timeout: 20_000 });
        await checkScreen(page, look, "night-offer", info.project.name, errors);
      });

      test("win98: the Start menu, Run and the hole", async ({ page }, info) => {
        const project = info.project.name;
        await openLibrary(page);
        await settle(page);
        await page.getByTestId("w98-start").click();
        await expect(page.getByTestId("w98-start-menu")).toBeVisible();
        const menu = (await page.getByTestId("w98-start-menu").innerText()).toLowerCase();
        expect(menu).not.toMatch(/\bradio\b/);
        await checkScreen(page, look, "start-menu", project, errors);
        await page.keyboard.press("Escape");
        await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.type("hole");
        await expect(page.getByTestId("w98-mels-hole")).toBeVisible({ timeout: 10_000 });
        await checkScreen(page, look, "mels-hole", project, errors);
      });
    }
  });
}
