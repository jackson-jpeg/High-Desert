import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Mount a real hook and hand back what it returns.
 *
 * Shared because the alternative is what this directory used to do: assert
 * against a hand-written copy of the production function, which passes happily
 * while the real one drifts out from under it. `restore-play.test.ts` declared
 * its own `primeEpisode` and inlined `togglePlay`'s no-source branch, and by the
 * time anyone looked the real `primeEpisode` had gained a `notifySourceChanged()`
 * call and a `playbackRate` assignment that the copy knew nothing about. Six
 * green tests, none of them touching the file they were named after.
 *
 * So the mounting plumbing lives here and every suite exercises the real thing.
 * `vi.mock` factories deliberately do NOT live here — they hoist, and each
 * suite's mocks are part of what it is asserting.
 */

// React 19 refuses to run act() without this, and warns on every render.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted<T> {
  /** Whatever the hook returned on its most recent render. */
  api: T;
  unmount: () => void;
}

/**
 * The handoff goes through an effect rather than an assignment during render:
 * writing to an outer variable mid-render is a side effect, and the lint rules
 * this repo runs are right to refuse it. Effects flush before act() returns, so
 * the sink is populated by the time this does.
 */
export function mountHook<T>(useHook: () => T): Mounted<T> {
  const sink: { api?: T } = {};

  function Harness() {
    const api = useHook();
    useEffect(() => {
      sink.api = api;
    });
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(createElement(Harness));
  });

  return {
    get api() {
      return sink.api!;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/**
 * A media element jsdom will accept, with the bits it refuses to implement.
 *
 * `readyState` is writable so a test can say "this element has data" — the
 * difference between a stalled load and a playing show, which is the distinction
 * both the watchdog and `togglePlay`'s first-play detection turn on.
 */
export function makeMediaElement(
  play: () => Promise<void> = () => Promise.resolve(),
): HTMLAudioElement {
  const el = document.createElement("audio");
  el.play = play as HTMLAudioElement["play"];
  el.load = () => {};
  setReadyState(el, 0);
  return el;
}

export function setReadyState(el: HTMLAudioElement, value: number): void {
  Object.defineProperty(el, "readyState", {
    value,
    writable: true,
    configurable: true,
  });
}
