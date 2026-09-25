import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlaybackControls } from "../PlaybackControls";
import { usePlayerStore } from "@/stores/player-store";
import { useLiveStore } from "@/stores/live-store";
import { useToastStore } from "@/stores/toast-store";

/**
 * While tuned in, the speed button says why it will not change speed rather
 * than setting a rate the station then fights with a seek every ten seconds.
 * Held paused, or not tuned at all, it works as it always did.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const noop = () => {};

function speedButton(mobile: boolean): HTMLButtonElement {
  act(() =>
    root.render(
      createElement(PlaybackControls, { onTogglePlay: noop, onSeek: noop, onStop: noop, mobileVolumeOnly: mobile }),
    ),
  );
  return host.querySelector<HTMLButtonElement>('button[aria-label^="Playback speed"]')!;
}

beforeEach(() => {
  usePlayerStore.setState({ playbackRate: 1 });
  useLiveStore.setState({ tuned: false, paused: false, phase: "off" });
  useToastStore.setState({ toasts: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the speed button while live", () => {
  for (const mobile of [false, true]) {
    it(`${mobile ? "mobile" : "desktop"}: refused with a reason while tuned; works when held or not tuned`, () => {
      useLiveStore.setState({ tuned: true, phase: "show" });
      const refused = speedButton(mobile);
      act(() => refused.click());
      expect(usePlayerStore.getState().playbackRate).toBe(1);
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/listening live/);

      act(() => useLiveStore.setState({ paused: true }));
      const allowed = speedButton(mobile);
      act(() => allowed.click());
      expect(usePlayerStore.getState().playbackRate).toBe(1.25);
    });
  }
});
