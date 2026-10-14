/**
 * The Request Line in a real browser (2026-10-14, docs/request-line.md).
 *
 * Needs the phone lines behind the same origin (scripts/live-e2e-stack.mjs,
 * as CI runs it). **Local stacks only**: it nominates and votes for real, and
 * a nomination is public on the page, so it skips itself against any host
 * that is not loopback (production included).
 *
 *   - Request it on a show page answers beside the button; the Request Line
 *     lists the pick with its vote, and a second listener's one tap adds one.
 *   - Request it is in the Library's episode panel.
 *   - Live says tonight's request, on a phone and a desktop, in both looks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, anotherClientAddress, answerServerWrites, type Page } from "./fixtures";

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.E2E_BASE_URL?.replace(/\/$/, "") ?? "");
const SHOTS = path.join(process.cwd(), "test-results/request-line");

const slugs = JSON.parse(readFileSync(path.join(process.cwd(), "data/show-slugs.json"), "utf8")) as Record<string, string>;
const seed = JSON.parse(readFileSync(path.join(process.cwd(), "public/seed/library.json"), "utf8")) as {
  fileHash: string;
  fileName: string;
  archiveIdentifier?: string;
  duration?: number;
}[];
/** A catalog show with a page, picked per run so reruns the same day rarely meet. */
function someShow(offset = 0) {
  const shows = seed.filter((r) => slugs[r.fileHash] && r.archiveIdentifier && (r.duration ?? 0) > 0);
  return shows[(Math.floor(Date.now() / 1000) + offset * 97) % shows.length];
}
const keyOf = (r: { archiveIdentifier?: string; fileName: string }) =>
  `${r.archiveIdentifier}--${r.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;

async function setLook(page: Page, look: "win98" | "night") {
  const host = new URL(process.env.E2E_BASE_URL!).hostname;
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
}

test.describe("the Request Line", () => {
  test.skip(!LOCAL, "writes real nominations: local stacks only");

  test("Request it on a show page, then the list, then a second listener's vote", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one listener flow is enough; the phone runs the Live note");
    // Try a few shows: one may have aired on this database in the last 30 days.
    let status = "";
    let picked = someShow();
    for (let i = 0; i < 5; i++) {
      picked = someShow(i);
      await page.goto(`/show/${slugs[picked.fileHash]}`);
      await page.getByTestId("request-it-button").click();
      const s = page.getByTestId("request-it-status");
      await expect(s).toBeVisible();
      status = (await s.textContent()) ?? "";
      if (/Requested|already|vote is in/.test(status) && !/already picked a show today/.test(status)) break;
    }
    expect(status).toMatch(/Requested\. It is on the Request Line|Your vote is in|You already voted/);
    expect(status).not.toContain("—");

    await page.getByTestId("request-it-status").getByRole("link", { name: "See the Request Line" }).click();
    await expect(page).toHaveURL(/\/request-line$/);
    const row = page.getByTestId("request-row").filter({ has: page.locator(`a[href="/show/${slugs[picked.fileHash]}"]`) });
    await expect(row).toHaveCount(1);
    const before = Number((await row.getByTestId("request-votes").textContent())!.match(/\d+/)![0]);
    await expect(row.getByTestId("request-vote")).toHaveText("Voted");
    await page.screenshot({ path: `${SHOTS}/request-line-desktop.png`, fullPage: true });

    // Another listener: a fresh browser on another address.
    const other = await browser.newContext({ serviceWorkers: "block", extraHTTPHeaders: { "x-forwarded-for": anotherClientAddress(testInfo.workerIndex) } });
    const p2 = await other.newPage();
    await answerServerWrites(p2, []);
    await p2.goto("/request-line");
    const row2 = p2.getByTestId("request-row").filter({ has: p2.locator(`a[href="/show/${slugs[picked.fileHash]}"]`) });
    await row2.getByTestId("request-vote").click();
    await expect(row2.getByTestId("request-vote")).toHaveText("Voted");
    await expect(row2.getByTestId("request-votes")).toContainText(String(before + 1));
    // One vote per listener per show: the button is spent.
    await expect(row2.getByTestId("request-vote")).toBeDisabled();
    await other.close();
  });

  test("Request it is in the Library's episode panel", async ({ page }) => {
    const r = someShow(7);
    await page.goto(`/library?show=${encodeURIComponent(keyOf(r))}`);
    await expect(page.getByTestId("request-it-button").first()).toBeVisible({ timeout: 30_000 });
  });

  for (const look of ["night", "win98"] as const) {
    test(`a phone's first screen: the note right under Listen live, with Pick a show (${look})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "the phone layout");
      await setLook(page, look);
      await page.goto("/live");
      await expect(page.locator("#app-loading")).toBeHidden({ timeout: 30_000 });
      const hero = page.getByTestId("live-hero");
      const note = page.getByTestId("live-request-note");
      await expect(hero).toBeVisible({ timeout: 30_000 });
      const sched = (await (await page.request.get("/api/live/schedule")).json()) as { serverNow: number; guide: { kind: string; requestSlot?: boolean; end: number }[] };
      const slot = sched.guide.find((x) => x.kind === "request") ?? sched.guide.find((x) => x.requestSlot);
      test.skip(!!slot && sched.serverNow >= slot.end, "tonight's request has aired: no note, by design");
      await expect(note).toBeVisible();
      const h = (await hero.boundingBox())!;
      const n = (await note.boundingBox())!;
      const call = (await page.getByTestId("live-call-in").boundingBox())!;
      // Directly under the hero (one grid gap), above Call in.
      expect(n.y).toBeGreaterThanOrEqual(h.y + h.height);
      expect(n.y - (h.y + h.height)).toBeLessThan(24);
      expect(call.y).toBeGreaterThanOrEqual(n.y + n.height);
      // On the first screen of a 390-wide phone, button and all.
      const viewport = page.viewportSize()!;
      const pick = page.getByTestId("live-request-pick");
      await expect(pick).toHaveText("Pick a show");
      const p = (await pick.boundingBox())!;
      expect(p.y + p.height).toBeLessThanOrEqual(viewport.height);
      expect(p.height).toBeGreaterThanOrEqual(44);
      expect(p.x + p.width).toBeLessThanOrEqual(viewport.width);
      await expect(note).not.toContainText("—");
      await page.screenshot({ path: `${SHOTS}/phone-first-screen-${look}.png` });
      await pick.click();
      await expect(page).toHaveURL(/\/request-line$/);
      await page.screenshot({ path: `${SHOTS}/phone-request-line-${look}.png`, fullPage: true });
    });

    test(`the Request Line is in the menu (${look})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "Night's More sheet and Win98's Start menu on a phone");
      await setLook(page, look);
      await page.goto("/live");
      await expect(page.locator("#app-loading")).toBeHidden({ timeout: 30_000 });
      if (look === "night") {
        await page.locator('[data-nav="more"]').click();
        const item = page.getByTestId("more-request-line");
        await expect(item).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/phone-menu-${look}.png` });
        await item.click();
      } else {
        await page.getByTestId("w98-start").click();
        const item = page.getByTestId("w98-start-menu").getByRole("menuitem", { name: /Request Line/ });
        await expect(item).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/phone-menu-${look}.png` });
        await item.click();
      }
      await expect(page).toHaveURL(/\/request-line$/);
    });

  for (const look of ["night", "win98"] as const) {
    test(`Live says tonight's request (${look})`, async ({ page }, testInfo) => {
      await setLook(page, look);
      await page.goto("/live");
      const note = page.getByTestId("live-request-note");
      // After tonight's request has aired the note is gone, by design.
      const sched = (await (await page.request.get("/api/live/schedule")).json()) as {
        serverNow: number;
        guide: { kind: string; requestSlot?: boolean; end: number }[];
      };
      const slot = sched.guide.find((x) => x.kind === "request") ?? sched.guide.find((x) => x.requestSlot);
      if (slot && sched.serverNow >= slot.end) {
        await expect(page.getByTestId("live-hero").or(page.getByTestId("live-clock")).first()).toBeVisible({ timeout: 30_000 });
        await expect(note).toHaveCount(0);
        return;
      }
      await expect(note).toBeVisible({ timeout: 30_000 });
      // A desktop's note is one link; a phone's has its own Pick a show button.
      const link = testInfo.project.name === "mobile" ? page.getByTestId("live-request-pick") : note;
      await expect(link).toHaveAttribute("href", "/request-line");
      await expect(note).toContainText(/Tonight's request at 10 PM|No request tonight/);
      // The boot screen sits over the page for its first seconds.
      await expect(page.locator("#app-loading")).toBeHidden({ timeout: 30_000 });
      await note.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/live-${look}-${testInfo.project.name}.png` });
    });
  }
});
