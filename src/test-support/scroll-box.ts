import { act } from "react";

/**
 * jsdom lays nothing out: scrollHeight and clientHeight are 0 and scrollTop
 * does not move. This gives one scrolling element real numbers, so a test can
 * scroll it up and see whether new content moves it (the phone lines'
 * useFollowLog). `scrollHeight` is read on every call, so content can "grow".
 */
export function fakeScrollBox(el: HTMLElement, { content = 2000, client = 300 } = {}) {
  let top = 0;
  let height = content;
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, height - client))) });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => client });
  const scrollTo = (to: number) =>
    act(() => {
      el.scrollTop = to;
      el.dispatchEvent(new Event("scroll"));
    });
  return {
    get top() {
      return top;
    },
    /** The furthest scrollTop can go: the bottom. */
    get bottom() {
      return height - client;
    },
    grow(by: number) {
      height += by;
    },
    scrollTo,
    scrollUp: () => scrollTo(0),
    scrollToBottom: () => scrollTo(height - client),
  };
}
