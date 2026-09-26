import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, anotherClientAddress } from "./fixtures";

/**
 * The Live bugs a real listener hit on 2026-09-25, each as the listener met it.
 *
 * e2e/live.spec.ts and e2e/live-chat.spec.ts passed the whole time these were
 * broken: they checked that two browsers heard the same second and that a line
 * crossed the wire, and never did what a listener does next — rename, refresh,
 * leave, pause, read the label, read the heading. docs/live-qa.md has the list.
 *
 * Needs the chat service behind the same origin (scripts/live-e2e-stack.mjs, as
 * CI runs it) and, for the audio tests, archive.org reachable from the machine
 * running the browser (they skip, saying so, when it is not).
 *
 * The presence test lets this page's own heartbeats through to the server — a
 * presence mark that expires in five minutes, never a play. Every other stats
 * write is still answered in the page by the fixture.
 */

const ARCHIVE_PROBE = "https://archive.org/services/check";
const rnd = () => Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6).padEnd(6, "x");
/** A name the filter refuses, not written here in plain text (the fixtures' rule). */
const REFUSED_NAME = Buffer.from("bmlnZ2VyIGluIEJhcnN0b3c=", "base64").toString("utf8");

async function archiveReachable(request: import("@playwright/test").APIRequestContext) {
  return request
    .head(ARCHIVE_PROBE, { timeout: 10_000 })
    .then((r) => r.status() < 500)
    .catch(() => false);
}

async function openLines(page: Page, mobile: boolean) {
  await page.goto("/live");
  if (mobile) await page.getByRole("button", { name: /phone lines/i }).first().click();
  await expect(page.getByTestId("you-name")).not.toBeEmpty({ timeout: 30_000 });
}

async function call(page: Page, text: string) {
  await page.getByPlaceholder(/^Call in/).fill(text);
  const posted = page.waitForResponse((r) => r.url().includes("/live-api/messages") && r.request().method() === "POST");
  await page.getByTestId("send").click();
  return posted;
}

async function rename(page: Page, name: string) {
  await page.getByTestId("change-name").click();
  const box = page.getByRole("textbox", { name: "Caller name" });
  await expect(box).toBeVisible();
  await box.fill(name);
  await page.getByTestId("save-name").click();
}

/** Keep hold of the player's detached element from its first real play(). */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hdEl: HTMLMediaElement | null };
    w.__hdEl = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.src && /^https?:/.test(this.src)) w.__hdEl = this;
      return play.call(this);
    };
  });
}

function element(page: Page) {
  return page.evaluate(() => {
    const el = (window as unknown as { __hdEl: HTMLMediaElement | null }).__hdEl;
    if (!el) return null;
    return { paused: el.paused, currentTime: el.currentTime, src: el.currentSrc || el.getAttribute("src") || "", ready: el.readyState };
  });
}

/** Where the station is right now, in seconds into the current show, by the server's clock. */
async function stationOffset(page: Page) {
  const s = await (await page.request.get("/api/live/schedule")).json();
  if (!("slot" in s.now)) return null;
  return { offset: (Date.now() - s.now.slot.start) / 1000, fileHash: s.now.slot.fileHash as string };
}

async function tuneIn(page: Page) {
  await page.goto("/live");
  await page.getByTestId("live-tune-in").click();
  await expect.poll(async () => (await element(page))?.paused === false && ((await element(page))?.currentTime ?? 0) > 0, { timeout: 60_000 }).toBe(true);
}

/** The line beside "You're <name> on …" in the phone lines' header. */
const youLine = (page: Page) => page.getByTestId("you-name").locator("xpath=following-sibling::span[1]");

const leaveButton = (page: Page) => page.getByRole("button", { name: "Leave the station" });
const playerButton = (page: Page, name: "Play" | "Pause") => page.getByRole("button", { name, exact: true }).first();

// ---------------------------------------------------------------------------
// 1. Change name
// ---------------------------------------------------------------------------

test("change name: refused and rate-limited names say why inline; a new name is on my next call, in other clients, and after a refresh", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const mobile = !!info.project.use.isMobile;
  const other: BrowserContext = await browser.newContext({
    ...info.project.use,
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": anotherClientAddress(info.workerIndex) },
  });
  try {
    const listener = await other.newPage();
    await Promise.all([openLines(page, mobile), openLines(listener, mobile)]);
    const before = (await page.getByTestId("you-name").textContent())!;

    // Too long: the editor says so, rather than a Save button that silently does nothing.
    await rename(page, "A Very Long Caller Name That Goes On Past The Limit");
    await expect(page.getByTestId("name-error")).toContainText(/at most 32/i);
    await page.getByTestId("name-editor").getByRole("button", { name: "Cancel" }).click();

    // Refused by the filter: an inline reason, and the name is unchanged.
    await rename(page, REFUSED_NAME);
    await expect(page.getByTestId("name-error")).toBeVisible();
    await expect(page.getByTestId("name-error")).not.toBeEmpty();
    await page.getByTestId("name-editor").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("you-name")).toHaveText(before);

    // A good one.
    const fresh = `Night Clerk in ${rnd().replace(/^./, (c) => c.toUpperCase())}`;
    await rename(page, fresh);
    await expect(page.getByTestId("you-name")).toHaveText(fresh);

    // My next call carries it, on my screen and on theirs.
    const text = `Renamed caller checking in ${rnd()}`;
    expect((await call(page, text)).status()).toBe(201);
    for (const p of [page, listener]) {
      const line = p.getByTestId("live-message").filter({ hasText: text });
      await expect(line.getByTestId("caller-name")).toHaveText(fresh, { timeout: 5_000 });
    }

    // A refresh keeps it.
    await openLines(page, mobile);
    await expect(page.getByTestId("you-name")).toHaveText(fresh);

    // A second change inside ten minutes: an inline wait, not nothing.
    await rename(page, `Day Clerk in ${rnd().replace(/^./, (c) => c.toUpperCase())}`);
    await expect(page.getByTestId("name-error")).toContainText(/10 minutes/);
    await expect(page.getByTestId("you-name")).toHaveCount(0); // still editing, the message beside it
  } finally {
    await other.close();
  }
});

// ---------------------------------------------------------------------------
// 4. A caller's line, and one label format
// ---------------------------------------------------------------------------

test("pressing Change name does not move or resize it (a press that reflows can lose its click)", async ({ page }, info) => {
  await openLines(page, !!info.project.use.isMobile);
  const button = page.getByRole("button", { name: "Change name" });
  // Layout, not paint: offset* ignore transforms, so the phone's deliberate
  // scale(0.97) press feedback (which reflows nothing) is not a change here.
  const layout = () =>
    button.evaluate((el: HTMLElement) => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight]);
  await button.hover();
  const before = await layout();
  await page.mouse.down();
  const pressed = await layout();
  await page.mouse.up();
  expect(pressed).toEqual(before);
});

test("a caller keeps one line across a refresh, and the label reads the same in the header and on every message", async ({ page }, info) => {
  test.setTimeout(90_000);
  const mobile = !!info.project.use.isMobile;
  await openLines(page, mobile);
  const header = youLine(page);
  const line = (await header.textContent())!.trim();
  expect(line).toMatch(/^(Line \d+|.+ Line|.+ of the Rockies|First-Time Callers)$/);

  const text = `Which line am I on ${rnd()}`;
  expect((await call(page, text)).status()).toBe(201);
  const mine = page.getByTestId("live-message").filter({ hasText: text });
  await expect(mine.getByTestId("line-label")).toHaveText(line);

  // After a refresh the same call comes back from history, not the live wire.
  await openLines(page, mobile);
  await expect(youLine(page)).toHaveText(line);
  await expect(page.getByTestId("live-message").filter({ hasText: text }).getByTestId("line-label")).toHaveText(line);
});

// ---------------------------------------------------------------------------
// 5 and 6. The studio's heading, and a placeholder that fits
// ---------------------------------------------------------------------------

test("the studio's main heading is the episode title", async ({ page }) => {
  await page.goto("/live");
  const s = await (await page.request.get("/api/live/schedule")).json();
  test.skip(!("slot" in s.now), "between shows: no episode on the air");
  const title: string = s.now.slot.title;
  const episodeTitle = title.includes(" - ") ? title.slice(title.indexOf(" - ") + 3) : title;
  const heading = page.getByRole("heading", { name: episodeTitle, exact: true });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(heading).toHaveAttribute("data-testid", "live-now-title");
});

test("the call-in placeholder fits its box, whatever the caller is called", async ({ page }, info) => {
  await openLines(page, !!info.project.use.isMobile);
  const name = (await page.getByTestId("you-name").textContent())!;
  const box = page.getByPlaceholder(/^Call in/);
  const fit = await box.evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { placeholder: el.placeholder, needs: Math.ceil(ctx.measureText(el.placeholder).width), room };
  });
  // It fits here...
  expect(fit.needs, `"${fit.placeholder}" in ${fit.room}px`).toBeLessThanOrEqual(fit.room);
  // ...and it cannot grow: a name can be 32 characters, and one that long cut
  // "Call in as Short-Wave Listener in Hawthorn" off at 390 wide and on desktop.
  expect(fit.placeholder).not.toContain(name);
});

// ---------------------------------------------------------------------------
// 2 and 3. Presence, leaving, and pausing — these play real audio
// ---------------------------------------------------------------------------

test.describe("tuned in", () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await archiveReachable(request)), "archive.org is not reachable from this machine");
    await installProbe(page);
  });

  test("join, refresh, resume: still counted live; leave: the count drops within one presence poll", async ({ page }) => {
    test.setTimeout(180_000);
    // This page's heartbeats reach the server; nothing else does (see the header).
    await page.route("**/api/stats/heartbeat", (route) => route.continue());
    const liveNow = async () => (await (await page.request.get("/api/stats/now")).json()).live as number;
    const base = await liveNow();

    await tuneIn(page);
    await expect.poll(liveNow, { timeout: 30_000 }).toBe(base + 1);

    // A refresh: the show comes back in the bottom player; ▶ resumes the station.
    await page.reload();
    await playerButton(page, "Play").click();
    await expect.poll(async () => (await element(page))?.paused === false, { timeout: 60_000 }).toBe(true);
    await expect(leaveButton(page)).toBeVisible();
    await expect.poll(liveNow, { timeout: 30_000 }).toBe(base + 1);
    // And the count on screen is that same number.
    await expect(page.getByTestId("live-listeners").first()).toHaveAttribute("data-live", String(base + 1), { timeout: 30_000 });

    await leaveButton(page).click();
    await expect.poll(liveNow, { timeout: 25_000 }).toBe(base);
  });

  test("Leave the station stops the audio and clears the player, and it stays cleared after a refresh", async ({ page }) => {
    test.setTimeout(150_000);
    await tuneIn(page);
    await expect(playerButton(page, "Pause")).toBeVisible();
    await leaveButton(page).click();
    await expect.poll(async () => (await element(page))?.paused, { timeout: 5_000 }).toBe(true);
    await expect(page.getByRole("button", { name: /^(Play|Pause)$/ })).toHaveCount(0);
    await expect(page.getByTestId("live-tune-in")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("live-tune-in")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^(Play|Pause)$/ })).toHaveCount(0);
  });

  test("playing a library show while live leaves the station", async ({ page }, info) => {
    test.setTimeout(150_000);
    await tuneIn(page);
    const stationSrc = (await element(page))!.src;
    await page.goto("/library");
    const row = page.getByRole("option").nth(3);
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Each layout's own gesture: a double-click on desktop; on a phone a tap
    // opens the episode sheet, whose ▶ Play starts it. (A tap alone starts
    // nothing, and a reload re-primes the element — so "src changed" is not
    // evidence; the other show must be the one playing.)
    if (info.project.use.isMobile) {
      await row.click();
      await page.getByRole("button", { name: "▶ Play" }).first().click();
    } else {
      await row.dblclick();
    }
    await expect
      .poll(async () => {
        const el = await element(page);
        return !!el && el.src !== stationSrc && !el.paused;
      }, { timeout: 30_000 })
      .toBe(true);
    await page.goto("/live");
    await expect(page.getByTestId("live-tune-in")).toBeVisible({ timeout: 30_000 });
    await expect(leaveButton(page)).toHaveCount(0);
  });

  test("pausing from the bottom player stays in the station, paused; resume jumps back to the live position", async ({ page }) => {
    test.setTimeout(150_000);
    await tuneIn(page);
    await playerButton(page, "Pause").click();
    await expect.poll(async () => (await element(page))?.paused, { timeout: 5_000 }).toBe(true);
    await expect(leaveButton(page)).toBeVisible();
    const pausedAt = (await element(page))!.currentTime;

    await page.waitForTimeout(8_000);
    await playerButton(page, "Play").click();
    await expect.poll(async () => (await element(page))?.paused === false, { timeout: 30_000 }).toBe(true);
    await expect(leaveButton(page)).toBeVisible();
    // Back on the station's second, not where it was paused.
    await expect
      .poll(async () => {
        const [el, st] = [await element(page), await stationOffset(page)];
        return el && st ? Math.abs(el.currentTime - st.offset) : Infinity;
      }, { timeout: 30_000 })
      .toBeLessThan(2);
    expect((await element(page))!.currentTime).toBeGreaterThan(pausedAt + 6);
  });
});

// ---------------------------------------------------------------------------
// The first-time listener audit (docs/live-qa.md)
// ---------------------------------------------------------------------------

test("a first visit can find the station from the welcome page", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("welcome-live").click();
  await expect(page).toHaveURL(/\/live$/, { timeout: 15_000 });
  await expect(page.getByTestId("live-tune-in")).toBeVisible({ timeout: 30_000 });
});

test("nothing in the studio is wider than the screen", async ({ page }) => {
  await page.goto("/live");
  await expect(page.getByTestId("live-now")).toBeVisible({ timeout: 30_000 });
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>("main *, [role=main] *, body *")]
      .filter((el) => el.closest('[data-testid="live-now"], [data-testid="live-listeners"], [data-testid="live-clock"], [data-testid="live-up-next"]'))
      .map((el) => el.getBoundingClientRect().right - vw)
      .filter((d) => d > 1).length;
  });
  // The count, the clock, the show and what is next are all on screen.
  expect(over).toBe(0);
  await expect(page.getByTestId("live-listeners").first()).toBeInViewport();
});

test("desktop: the call-in box is on screen and the newest call is in view", async ({ page }, info) => {
  test.skip(!!info.project.use.isMobile, "the phone opens the lines in a sheet");
  await page.goto("/live");
  const box = page.getByPlaceholder(/^Call in/);
  await expect(box).toBeInViewport({ timeout: 30_000 });
  const calls = page.getByTestId("live-message");
  await expect(calls.first()).toBeVisible({ timeout: 30_000 });
  await expect(calls.last()).toBeInViewport();
});

test.describe("tuned in, the station owns the playhead", () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await archiveReachable(request)), "archive.org is not reachable from this machine");
    await installProbe(page);
  });

  test("a seek while live is refused with a reason, not undone ten seconds later", async ({ page }, info) => {
    test.skip(!!info.project.use.isMobile, "the ±15/+30 buttons are the desktop player's");
    test.setTimeout(150_000);
    await tuneIn(page);
    await page.getByRole("button", { name: "Seek forward 30 seconds" }).first().click();
    await expect(page.getByText(/You're listening live: everyone hears the same second/).first()).toBeVisible();
    const [el, st] = [await element(page), await stationOffset(page)];
    expect(Math.abs(el!.currentTime - st!.offset)).toBeLessThan(3);
  });
});
