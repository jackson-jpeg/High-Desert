import { test, expect, type Page } from "./fixtures";
import type { APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openLibrary, episodeList } from "./library";
import { playFromFixtureMirror } from "./fixture-audio";

/**
 * Every user-facing screen, in every look, on a phone and a desktop
 * (docs/looks.md). Each screen is saved to test-results/looks/ (CI uploads
 * it as the `look-screenshots` artifact on every run, pass or fail), and held
 * to what a look must never do:
 *
 *   - the public look carries no `data-look` and no switcher, whatever else
 *     the run does: today's site, untouched;
 *   - a preview look is on the page it was asked for, and its switcher shows;
 *   - no uncaught page error;
 *   - nothing wider than a phone's screen;
 *   - no em dash in any text a preview look puts on screen (CLAUDE.md).
 *
 * A preview look is turned on the production way: the phone lines' admin
 * route (`/live-api/admin/look`, with the run's admin token as a bearer)
 * signs `hd_look`, and the app's proxy checks it (src/proxy.ts). So this
 * needs the e2e stack CI starts (`E2E_LIVE_ADMIN_TOKEN`, and the app started
 * with the matching `HD_LOOK_KEY`); without the token the preview looks skip,
 * and the public look still runs.
 *
 * Screenshots are evidence for a person comparing looks, not pixel baselines:
 * fonts and the live schedule differ between machines and minutes, and a
 * baseline that fails on a clock would be read past.
 */

const LOOKS = ["default", "clean", "win98"] as const;
type Look = (typeof LOOKS)[number];

const SHOW = "/show/1992-12-12-area-51-john-lear-bob-lazar";
const GUEST = "/guest/linda-moulton-howe";
const OUT = "test-results/looks";
mkdirSync(OUT, { recursive: true });

/** The `hd_look` value the admin route signs for `look`, or null without a token. */
async function signedLook(request: APIRequestContext, baseURL: string, look: Look): Promise<string | null> {
  const token = process.env.E2E_LIVE_ADMIN_TOKEN;
  if (!token) return null;
  const r = await request.post(`${baseURL}/live-api/admin/look`, {
    headers: { authorization: `Bearer ${token}`, origin: new URL(baseURL).origin, "content-type": "application/json" },
    data: { look },
  });
  expect(r.status(), "the admin route must sign a look").toBe(200);
  const set = r.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
  const m = set.map((c) => /^hd_look=([^;]+)/.exec(c)).find(Boolean);
  expect(m, "the admin route must set hd_look").toBeTruthy();
  return m![1];
}

async function enterLook(page: Page, baseURL: string, look: Look): Promise<void> {
  if (look === "default") return;
  const value = await signedLook(page.request, baseURL, look);
  test.skip(!value, "E2E_LIVE_ADMIN_TOKEN is not set: preview looks need the e2e stack's admin token");
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "hd_look", value: value!, domain: host, path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600); // let the look's components swap in after hydration
}

async function checkScreen(page: Page, look: Look, name: string, project: string, errors: string[]): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${project}-${look}-${name}.png` });
  const state = await page.evaluate(() => ({
    look: document.documentElement.getAttribute("data-look"),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    text: document.body.innerText,
    switcher: !!document.querySelector('[data-testid="look-switcher"]'),
  }));
  if (look === "default") {
    expect(state.look, `${name}: the public look carries no data-look`).toBeNull();
    expect(state.switcher, `${name}: the public look shows no switcher`).toBe(false);
  } else {
    expect(state.look, `${name}: the look must be on`).toBe(look);
    expect(state.switcher, `${name}: the owner's switcher must show`).toBe(true);
    expect(state.text.includes("—"), `${name}: an em dash on screen in ${look}`).toBe(false);
  }
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

    test("welcome, stats, live, show, guest, look and not-found pages", async ({ page }, info) => {
      const project = info.project.name;
      const screens: [string, string][] = [
        ["welcome", "/"],
        ["stats", "/stats"],
        ["live", "/live"],
        ["show", SHOW],
        ["guest", GUEST],
        ["look", "/look"],
        ["not-found", "/no-such-page-here"],
      ];
      for (const [name, path] of screens) {
        await page.goto(path);
        if (name === "show") await expect(page.locator("h1")).toBeVisible();
        await checkScreen(page, look, name, project, errors);
      }
    });

    test("library, its detail panel, and the dial", async ({ page }, info) => {
      const project = info.project.name;
      await openLibrary(page);
      await checkScreen(page, look, "library", project, errors);

      await episodeList(page).locator('[role="option"]').first().click();
      await checkScreen(page, look, "library-detail", project, errors);

      if (look !== "default") {
        await page.goto("/library?view=dial");
        await expect(page.getByTestId("library-dial")).toBeVisible({ timeout: 45_000 });
        await checkScreen(page, look, "library-dial", project, errors);
        // /radio is the dial in a preview look.
        await page.goto("/radio");
        await expect(page).toHaveURL(/\/library\?view=dial|\/library$/);
      } else {
        await page.goto("/radio");
        await expect(page).toHaveURL(/\/radio$/);
        await checkScreen(page, look, "radio", project, errors);
      }
    });

    test("the player, small and expanded", async ({ page }, info) => {
      const project = info.project.name;
      await playFromFixtureMirror(page);
      await openLibrary(page);
      await episodeList(page).locator('[role="option"]').first().dblclick();
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
