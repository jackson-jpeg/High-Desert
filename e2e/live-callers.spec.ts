import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { test, expect, anotherClientAddress, answerServerWrites } from "./fixtures";

/**
 * One browser, one caller (docs/live-chat.md, "Who is calling").
 *
 * The phone lines used to key every caller on their address, so two people in
 * one house, or strangers behind a mobile carrier's NAT, were one caller: one
 * name, one line, one rename limit, and one mute or ban for all of them. Each
 * test here opens two browser contexts that send the same X-Forwarded-For,
 * which is exactly what nginx sends for two browsers behind one address, and
 * checks that they are two callers.
 *
 * Needs the one-origin stack (scripts/live-e2e-stack.mjs) as CI runs it, and
 * E2E_LIVE_ADMIN_TOKEN for the mute and ban. Against production, see
 * docs/live-chat.md: only the first test is run there (a ban would hold the
 * address the checks run from).
 */

const ADMIN = process.env.E2E_LIVE_ADMIN_TOKEN;
const rnd = () => Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6).padEnd(6, "x");
const properName = (prefix: string) => `${prefix} ${rnd().replace(/^./, (c) => c.toUpperCase())}`;

/** Two browsers behind one address. */
async function household(browser: Browser, info: TestInfo): Promise<{ a: Page; b: Page; contexts: BrowserContext[] }> {
  const address = anotherClientAddress(info.workerIndex);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({
      ...info.project.use,
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": address },
    });
    const page = await ctx.newPage();
    await answerServerWrites(page, []);
    contexts.push(ctx);
    pages.push(page);
  }
  return { a: pages[0], b: pages[1], contexts };
}

async function openLines(page: Page, mobile: boolean) {
  await page.goto("/live");
  if (mobile) await page.getByRole("button", { name: /phone lines/i }).first().click();
  await expect(page.getByTestId("you-name")).not.toBeEmpty({ timeout: 30_000 });
}

async function rename(page: Page, name: string) {
  await page.getByTestId("change-name").click();
  await page.getByRole("textbox", { name: "Caller name" }).fill(name);
  const saved = page.waitForResponse((r) => r.url().includes("/live-api/name") && r.request().method() === "POST");
  await page.getByTestId("save-name").click();
  return saved;
}

async function call(page: Page, text: string) {
  await page.getByPlaceholder(/^Call in/).fill(text);
  const posted = page.waitForResponse((r) => r.url().includes("/live-api/messages") && r.request().method() === "POST");
  await page.getByTestId("send").click();
  return posted;
}

async function admin(page: Page, action: "mute" | "ban", body: Record<string, unknown>) {
  const origin = new URL(page.url()).origin;
  const r = await page.request.post(`/live-api/admin/${action}`, {
    headers: { authorization: `Bearer ${ADMIN}`, origin },
    data: body,
  });
  expect(r.status()).toBe(200);
}

const youName = (p: Page) => p.getByTestId("you-name");
const youLine = (p: Page) => p.getByTestId("you-line");

test("two browsers behind one address are two callers: their own names and lines, and each renames on its own", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const mobile = !!info.project.use.isMobile;
  const { a, b, contexts } = await household(browser, info);
  try {
    await openLines(a, mobile);
    await openLines(b, mobile);
    const [nameA, nameB] = [await youName(a).textContent(), await youName(b).textContent()];
    expect(nameA).not.toBe(nameB);
    expect(await youLine(a).textContent()).not.toBe(await youLine(b).textContent());

    // Each renames, one straight after the other: the limit is per browser.
    const freshA = properName("Porch Light");
    const freshB = properName("Kitchen Radio");
    expect((await rename(a, freshA)).status()).toBe(200);
    expect((await rename(b, freshB)).status()).toBe(200);
    await expect(youName(a)).toHaveText(freshA);
    await expect(youName(b)).toHaveText(freshB);

    // Each call carries its own caller's name, on both screens.
    const textA = `from the porch ${rnd()}`;
    const textB = `from the kitchen ${rnd()}`;
    expect((await call(a, textA)).status()).toBe(201);
    expect((await call(b, textB)).status()).toBe(201);
    for (const p of [a, b]) {
      await expect(p.getByTestId("live-message").filter({ hasText: textA }).getByTestId("caller-name")).toHaveText(freshA);
      await expect(p.getByTestId("live-message").filter({ hasText: textB }).getByTestId("caller-name")).toHaveText(freshB);
    }

    // A refresh keeps each browser its own caller.
    await openLines(a, mobile);
    await openLines(b, mobile);
    await expect(youName(a)).toHaveText(freshA);
    await expect(youName(b)).toHaveText(freshB);
  } finally {
    for (const c of contexts) await c.close();
  }
});

test("muting one browser does not mute the other behind the same address", async ({ browser }, info) => {
  test.skip(!ADMIN, "needs E2E_LIVE_ADMIN_TOKEN");
  test.setTimeout(120_000);
  const mobile = !!info.project.use.isMobile;
  const { a, b, contexts } = await household(browser, info);
  try {
    await openLines(a, mobile);
    await openLines(b, mobile);
    const posted = await call(a, `about to be muted ${rnd()}`);
    expect(posted.status()).toBe(201);
    await admin(a, "mute", { messageId: (await posted.json()).id, minutes: 5 });

    expect((await call(a, `still here ${rnd()}`)).status()).toBe(403);
    await expect(a.getByTestId("live-rejection")).toContainText(/on hold/i);
    expect((await call(b, `the other one ${rnd()}`)).status()).toBe(201);
  } finally {
    for (const c of contexts) await c.close();
  }
});

test("a banned browser that clears its cookies meets the address hold; the other browser there keeps calling", async ({ browser }, info) => {
  test.skip(!ADMIN, "needs E2E_LIVE_ADMIN_TOKEN");
  test.setTimeout(120_000);
  const mobile = !!info.project.use.isMobile;
  const { a, b, contexts } = await household(browser, info);
  try {
    await openLines(a, mobile);
    await openLines(b, mobile);
    expect((await call(b, `already on the line ${rnd()}`)).status()).toBe(201);
    const posted = await call(a, `about to be banned ${rnd()}`);
    await admin(a, "ban", { messageId: (await posted.json()).id });

    // Clearing cookies makes a new caller, who can listen...
    await contexts[0].clearCookies();
    await openLines(a, mobile);
    // ...but cannot start talking while the address is held.
    const again = await call(a, `back again ${rnd()}`);
    expect(again.status()).toBe(429);
    expect((await again.json()).error).toBe("address-hold");
    await expect(a.getByTestId("live-rejection")).toContainText("New callers from your network are on hold for a while.");

    // The browser that was already calling is untouched.
    await b.waitForTimeout(3_100); // its own 3 s pace
    expect((await call(b, `still on the line ${rnd()}`)).status()).toBe(201);
  } finally {
    for (const c of contexts) await c.close();
  }
});
