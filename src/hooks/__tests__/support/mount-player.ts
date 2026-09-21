import { createElement, useEffect } from "react";
import { vi } from "vitest";
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
 *
 * `load()` and `pause()` reject every pending `play()` promise with an
 * `AbortError`, because that is what real browsers do and what the play path
 * has to survive (HD-003). The stub this replaced made `load()` a no-op, so a
 * test could not even express "B started while A's play() was pending": A's
 * promise just sat there, and the bug — A's rejection being charged to B —
 * could not happen in the one place built to catch it.
 *
 * `paused` is tracked the way the element reports it: `play()` clears it
 * synchronously, `pause()` and `load()` set it.
 */
export function makeMediaElement(
  play: () => Promise<void> = () => Promise.resolve(),
): HTMLAudioElement {
  const el = document.createElement("audio");
  const pending = new Set<(err: DOMException) => void>();
  let paused = true;

  Object.defineProperty(el, "paused", {
    get: () => paused,
    configurable: true,
  });

  const abortPending = (message: string) => {
    for (const reject of [...pending]) {
      reject(new DOMException(message, "AbortError"));
    }
  };

  // A spy, so suites can assert on play() calls as they did against the old stub.
  el.play = vi.fn(() => {
    paused = false;
    return new Promise<void>((resolve, reject) => {
      const abort = (err: DOMException) => {
        pending.delete(abort);
        reject(err);
      };
      pending.add(abort);
      play().then(
        () => {
          if (pending.delete(abort)) resolve();
        },
        (err: unknown) => {
          if (pending.delete(abort)) {
            paused = true;
            reject(err);
          }
        },
      );
    });
  }) as unknown as HTMLAudioElement["play"];

  el.pause = () => {
    paused = true;
    abortPending("The play() request was interrupted by a call to pause().");
  };

  el.load = () => {
    paused = true;
    abortPending("The play() request was interrupted by a new load request.");
  };

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
