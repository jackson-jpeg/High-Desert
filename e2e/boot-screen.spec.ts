/**
 * The boot screen must not swallow a tap while it fades.
 *
 * dismiss() (src/app/boot-script.ts) fades #app-loading to opacity 0 and only
 * sets display:none 400ms later. Until the fix it stayed hit-testable for those
 * 400ms, so a tap on what was visibly the page reached the overlay and did
 * nothing. The unit test proves the style is set; this proves Chromium's hit
 * testing agrees, on a real first visit with its real 2.8s boot floor.
 *
 * The fade window is 400ms, far too short to hit reliably from the test
 * process under load, and a probe that happened to land after display:none
 * would pass whether or not pointer-events was ever set
 * (docs/disconnected-checks.md). So the one timer that ends the window — the
 * boot script's `display = 'none'` — is held until the test releases it, and
 * the overlay's display is still asserted at each observation.
 */
import { expect, test } from "./fixtures";

test("a tap during the boot screen's fade reaches the page", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __clicks: { inOverlay: boolean; overlayDisplay: string }[];
      __heldHide: (() => void) | null;
    };
    // Hold the end of the fade: the boot script's own display:none timer, and
    // nothing else — matched on its whole source (inlined unminified), because
    // dismiss() itself also contains that text and must not be held.
    w.__heldHide = null;
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (typeof fn === "function" && /^function\s*\(\)\s*\{\s*if \(el\) el\.style\.display = 'none';\s*\}$/.test(fn.toString())) {
        w.__heldHide = () => (fn as () => void)();
        return 0;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof window.setTimeout;

    // Record, for every click, whether it landed in the overlay and whether
    // the overlay was still displayed at that moment.
    w.__clicks = [];
    document.addEventListener(
      "click",
      (e) => {
        const overlay = document.getElementById("app-loading");
        w.__clicks.push({
          inOverlay: !!(e.target as Element | null)?.closest?.("#app-loading"),
          overlayDisplay: overlay ? getComputedStyle(overlay).display : "gone",
        });
      },
      true,
    );
  });
  await page.goto("/library");

  const vp = page.viewportSize()!;
  const x = Math.round(vp.width / 2);
  const y = Math.round(vp.height / 2);

  // Once dismiss() has started the fade (and its end is held), hit-test the
  // viewport centre.
  const probe = await (
    await page.waitForFunction(
      ([px, py]) => {
        const el = document.getElementById("app-loading");
        if (!el || el.style.opacity !== "0") return null;
        const hit = document.elementFromPoint(px, py);
        return {
          display: getComputedStyle(el).display,
          hitInOverlay: !!hit?.closest("#app-loading"),
          hitTag: hit?.tagName ?? null,
        };
      },
      [x, y] as const,
      { timeout: 15_000 },
    )
  ).jsonValue();
  if (!probe) throw new Error("waitForFunction resolved without a probe");

  expect(probe.display, "probe must run inside the fade window").not.toBe("none");
  expect(probe.hitTag, "something on the page must be under the point").not.toBeNull();
  expect(probe.hitInOverlay, "hit-testing during the fade must reach the page").toBe(false);

  // And a real click, dispatched by Chromium's input pipeline, not a hit-test.
  await page.mouse.click(x, y);
  const clicks = await page.evaluate(
    () => (window as unknown as { __clicks: { inOverlay: boolean; overlayDisplay: string }[] }).__clicks,
  );
  expect(clicks.length).toBeGreaterThan(0);
  expect(clicks[0].overlayDisplay, "the click must land inside the fade window").not.toBe("none");
  expect(clicks[0].inOverlay, "the click must reach the page, not the fading overlay").toBe(false);

  // Control: the hold really was the boot script's timer — releasing it ends the fade.
  await page.evaluate(() => (window as unknown as { __heldHide: (() => void) | null }).__heldHide?.());
  await expect(page.locator("#app-loading")).toBeHidden();
});
