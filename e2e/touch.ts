/**
 * Touch scrolling the way a thumb does it, for phone specs.
 *
 * - **Chromium** (the `mobile` project): `Input.synthesizeScrollGesture` with
 *   `gestureSourceType: "touch"`. That is the browser's own touch pipeline: real
 *   touchstart/touchmove/touchend reach the page, the compositor scrolls
 *   natively, and a fling keeps going after the finger lifts.
 * - **WebKit** (the `iphone` project, Mobile Safari's engine): Playwright has
 *   no touch drag for WebKit, so a swipe is real `TouchEvent`s dispatched along
 *   the finger's path, each move followed by the scroll it would cause on the
 *   element under the finger (real scroll events), then a few frames of
 *   momentum. iOS also bounces past each end and keeps firing scroll events
 *   there; a swipe at an end here dispatches its touches and moves nothing.
 *
 * Neither is an iPhone. They are the closest a Linux box gets, and the spec
 * says so where it matters.
 */
import type { Page, CDPSession } from "@playwright/test";

const cdpSessions = new WeakMap<Page, CDPSession>();

async function cdp(page: Page): Promise<CDPSession | null> {
  if (page.context().browser()?.browserType().name() !== "chromium") return null;
  let s = cdpSessions.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    cdpSessions.set(page, s);
  }
  return s;
}

/** Where a thumb rests: the middle of the screen, a little low. */
export async function thumb(page: Page): Promise<{ x: number; y: number }> {
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  return { x: Math.round(vp.width / 2), y: Math.round(vp.height * 0.6) };
}

/**
 * One swipe. `dy` > 0 scrolls the content down (the finger moves up), < 0
 * pulls it back toward the top.
 */
export async function swipe(page: Page, dy: number, at?: { x: number; y: number }): Promise<void> {
  const p = at ?? (await thumb(page));
  const session = await cdp(page);
  if (session) {
    // A thumb's stroke stays on the screen: at most 60% of its height, then
    // the fling carries the content on (as a flick does).
    const vh = page.viewportSize()?.height ?? 844;
    const stroke = Math.sign(dy) * Math.min(Math.abs(dy), Math.round(vh * 0.6));
    await session.send("Input.synthesizeScrollGesture", {
      x: p.x,
      y: dy > 0 ? Math.round(vh * 0.8) : Math.round(vh * 0.2),
      yDistance: -stroke,
      gestureSourceType: "touch",
      speed: 3000,
      preventFling: false,
    });
    // Let the fling run out before the next stroke.
    await page.waitForTimeout(400);
    return;
  }
  await page.evaluate(
    async ({ x, y, dy }) => {
      // Timers, not requestAnimationFrame: headless WebKit throttles rAF.
      const frame = () => new Promise<void>((r) => setTimeout(r, 16));
      const start = document.elementFromPoint(x, y) ?? document.body;
      const scrollable = (el: Element | null): Element => {
        for (let e = el; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
        }
        return document.scrollingElement ?? document.documentElement;
      };
      const scroller = scrollable(start);
      // WebKit on Linux has no Touch constructor; a TouchEvent-typed Event
      // carrying the same touch lists is what the page's handlers read.
      const touchAt = (cy: number) => ({ identifier: 1, target: start, clientX: x, clientY: cy, pageX: x, pageY: cy, screenX: x, screenY: cy, radiusX: 11, radiusY: 11, force: 0.5 });
      const fire = (type: string, cy: number) => {
        const t = touchAt(cy);
        const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
        const list = (items: unknown[]) => Object.assign([...items], { item: (i: number) => items[i] ?? null });
        Object.defineProperties(ev, {
          touches: { value: list(type === "touchend" ? [] : [t]) },
          targetTouches: { value: list(type === "touchend" ? [] : [t]) },
          changedTouches: { value: list([t]) },
        });
        start.dispatchEvent(ev);
      };
      const steps = 12;
      const travel = Math.max(-y + 20, Math.min(window.innerHeight - y - 20, -dy));
      fire("touchstart", y);
      for (let i = 1; i <= steps; i++) {
        fire("touchmove", y + (travel * i) / steps);
        scroller.scrollBy(0, dy / steps / 2);
        await frame();
      }
      fire("touchend", y + travel);
      // Momentum: the other half of the distance, decaying.
      let left = dy / 2;
      for (let i = 0; i < 8; i++) {
        const step = left / 2;
        scroller.scrollBy(0, step);
        left -= step;
        await frame();
      }
    },
    { x: p.x, y: p.y, dy },
  );
}
