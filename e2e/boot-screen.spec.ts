/**
 * The boot screen must not swallow a tap while it fades.
 *
 * dismiss() (src/app/boot-script.ts) fades #app-loading to opacity 0 and only
 * sets display:none 400ms later. Until the fix it stayed hit-testable for those
 * 400ms, so a tap on what was visibly the page reached the overlay and did
 * nothing. The unit test proves the style is set; this proves Chromium's hit
 * testing agrees, on a real first visit with its real 2.8s boot floor.
 *
 * Both observations are taken *inside* the fade window — the overlay's display
 * is recorded alongside each, and asserted not to be "none" yet. Without that,
 * a probe that happened to run after display:none would pass whether or not
 * pointer-events was ever set (docs/disconnected-checks.md).
 */
import { expect, test } from "@playwright/test";

test("a tap during the boot screen's fade reaches the page", async ({ page }) => {
  // Record, for every click, whether it landed in the overlay and whether the
  // overlay was still displayed at that moment.
  await page.addInitScript(() => {
    const w = window as unknown as { __clicks: { inOverlay: boolean; overlayDisplay: string }[] };
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

  // The first animation frame on which dismiss() has started the fade. Hit-test
  // the viewport centre there, in the same frame.
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
      { polling: "raf", timeout: 15_000 },
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
});
