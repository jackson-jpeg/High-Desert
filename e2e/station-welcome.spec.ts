import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "./fixtures";
import { episodeList } from "./library";

/**
 * The station first, for a new desktop visitor (src/lib/live/station-welcome.ts,
 * docs/funnel.md "The station on a desktop's first Library"). At 1440x900, in
 * both looks: a first visit to the Library shows "On the air now" with Listen
 * live on the first screen; Close puts it away, and a reload keeps it away. The
 * control: a browser that arrived with a library (the funnel's `cohort: null`)
 * never sees it.
 *
 * Needs a server with a live program: a local build on the e2e database (the
 * command is in e2e/live.spec.ts's header). Screenshots go to
 * test-results/station-welcome/ for a person to look at.
 */

const LOOKS = ["win98", "night"] as const;
type Look = (typeof LOOKS)[number];
const OUT = "test-results/station-welcome";
mkdirSync(OUT, { recursive: true });

test.use({ viewport: { width: 1440, height: 900 } });

async function enterLook(page: Page, baseURL: string, look: Look): Promise<void> {
  const host = new URL(baseURL).hostname;
  // A chosen look: the one-time Night offer is for browsers that never chose one.
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/library");
  await expect(episodeList(page).locator('[role="option"]').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 15_000 });
}

for (const look of LOOKS) {
  test(`${look}: a new desktop visitor meets the station above the Library, and Close keeps it closed`, async ({ page, baseURL }) => {
    await enterLook(page, baseURL!, look);
    await openLibrary(page);
    const welcome = page.getByTestId("station-welcome");
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    const listen = page.getByTestId("station-welcome-listen");
    await expect(listen).toBeVisible();
    const box = await listen.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(900);
    await expect(welcome).not.toContainText("—");
    await page.screenshot({ path: `${OUT}/${look}-first-visit.png` });

    await page.getByTestId("station-welcome-close").click();
    await expect(welcome).toBeHidden();
    await openLibrary(page);
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId("station-welcome")).toBeHidden();
  });

  test(`${look}: a browser that arrived with a library never sees it`, async ({ page, baseURL }) => {
    await enterLook(page, baseURL!, look);
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem("hd-funnel")) localStorage.setItem("hd-funnel", JSON.stringify({ cohort: null, done: [] }));
      } catch {
        /* storage unavailable: the funnel never decides, and the window never shows */
      }
    });
    await openLibrary(page);
    await page.waitForTimeout(5_000);
    await expect(page.getByTestId("station-welcome")).toBeHidden();
    // The station is still one tap away, in the player's idle strip.
    await expect(page.getByTestId("player-empty-tune")).toBeVisible();
  });
}
