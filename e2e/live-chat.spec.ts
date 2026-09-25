import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, anotherClientAddress } from "./fixtures";

/**
 * The phone lines, between two real browsers.
 *
 * Two contexts — two profiles, two client addresses — open /live. A call made
 * in one must appear in the other in under 2 s. A blocked word and a link are
 * refused, with the reason shown, and neither reaches the other caller.
 *
 * The blocked word is not written here in plain text (the filter fixtures'
 * rule): it is decoded from base64 at run time. It is one of the project's
 * outright-blocked terms, not a slur.
 *
 * Local stack (never TEST_DATABASE_URL):
 *   set -a; . /root/.high-desert-e2e.env; set +a
 *   psql "$E2E_DATABASE_URL" -f scripts/schema.sql -f services/live/schema.sql
 *   DATABASE_URL="$E2E_DATABASE_URL" npx next start -H 127.0.0.1 -p 3013 &
 *   LIVE_DATABASE_URL="$E2E_DATABASE_URL" CHAT_CLIENT_SECRET=e2e LIVE_PORT=3015 \
 *     LIVE_ORIGINS=http://127.0.0.1:3014 node services/live/server.mjs &
 *   node scripts/live-e2e-stack.mjs --port 3014 --app 3013 --live 3015 &
 *   E2E_BASE_URL=http://127.0.0.1:3014 npx playwright test e2e/live-chat.spec.ts
 *
 * Against production it posts one real, harmless call per project; set
 * E2E_LIVE_ADMIN_TOKEN and the spec hides it afterwards.
 */

const BLOCKED = Buffer.from("dGhyZWF0ZW4gdG8ga2lsbCB5b3U=", "base64").toString("utf8");

async function openLines(page: Page) {
  await page.goto("/live");
  const composer = page.getByTestId("composer");
  if (!(await composer.isVisible().catch(() => false))) {
    // On a phone the lines are in a sheet behind a button.
    await page.getByRole("button", { name: /phone lines/i }).first().click();
  }
  await expect(page.getByPlaceholder(/^Call in/)).toBeVisible({ timeout: 30_000 });
  // The stream has said hello: the caller has a name.
  await expect(page.getByTestId("you-name")).not.toBeEmpty({ timeout: 30_000 });
}

async function call(page: Page, text: string) {
  const box = page.getByPlaceholder(/^Call in/);
  await box.fill(text);
  const posted = page.waitForResponse((r) => r.url().includes("/live-api/messages") && r.request().method() === "POST");
  await page.getByTestId("send").click();
  return posted;
}

test("two callers hear each other in under 2 s; a blocked word and a link are refused", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const use = info.project.use;
  const other: BrowserContext = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": anotherClientAddress(info.workerIndex) },
  });
  const posted: number[] = [];
  try {
    const listener = await other.newPage();
    await Promise.all([openLines(page), openLines(listener)]);

    // A call, timed from the POST leaving to the line appearing on the other screen.
    const text = `Testing the lines from ${info.project.name}, ${Date.now().toString(36)}`;
    await listener.evaluate((t) => {
      const w = window as unknown as { __seenAt?: number };
      new MutationObserver((_, obs) => {
        const hit = [...document.querySelectorAll("[data-testid=message-body]")].some((n) => n.textContent === t);
        if (hit) {
          w.__seenAt = Date.now();
          obs.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }, text);
    const sentAt = Date.now();
    const res = await call(page, text);
    expect(res.status(), await res.text()).toBe(201);
    posted.push((await res.json()).id);
    const theirs = listener.getByTestId("live-message").filter({ hasText: text });
    await expect(theirs).toHaveCount(1, { timeout: 5_000 });
    const seenAt = await listener.evaluate(() => (window as unknown as { __seenAt?: number }).__seenAt ?? null);
    expect(seenAt, "the other caller's screen saw the call").not.toBeNull();
    const ms = seenAt! - sentAt;
    expect(ms, "delivery to the other caller").toBeLessThan(2_000);
    // It carries the phone-lines furniture: a line and a caller name.
    await expect(theirs.getByTestId("line-label")).not.toBeEmpty();
    await expect(theirs.getByTestId("caller-name")).not.toBeEmpty();
    info.annotations.push({ type: "delivery-ms", description: String(ms) });
    console.log(`[live-chat] ${info.project.name}: delivered in ${ms} ms`);

    // Past the 3 s per-caller limit, so the refusals below are the filter's.
    await page.waitForTimeout(3_200);
    const blocked = await call(page, `I will ${BLOCKED}`);
    expect(blocked.status()).toBe(400);
    expect((await blocked.json()).error).toBe("rejected");
    await expect(page.getByTestId("live-rejection")).toBeVisible();

    await page.waitForTimeout(3_200);
    const link = await call(page, "the tape is up at www.example.com/art");
    expect(link.status()).toBe(400);
    expect((await link.json()).reason).toMatch(/link/i);
    await expect(page.getByTestId("live-rejection")).toBeVisible();

    // Neither refused call reached the other caller.
    await listener.waitForTimeout(1_000);
    await expect(listener.getByTestId("message-body").filter({ hasText: /example\.com/ })).toHaveCount(0);
  } finally {
    const token = process.env.E2E_LIVE_ADMIN_TOKEN;
    if (token && posted.length) {
      for (const messageId of posted) {
        await page.request.post("/live-api/admin/hide", {
          headers: { authorization: `Bearer ${token}`, origin: new URL(use.baseURL!).origin },
          data: { messageId },
        });
      }
    }
    await other.close();
  }
});
