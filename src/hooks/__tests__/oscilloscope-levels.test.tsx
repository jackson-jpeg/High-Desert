import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The visualizers read their levels from src/audio/levels.ts, never from the
 * engine directly: that is what lets iOS use the level tap. This mounts the
 * real Oscilloscope (and so the real useOscilloscope draw loop), with the
 * levels module standing in, and checks the wiring both ways:
 *
 *   - mounting retains the levels (the tap may fetch) and unmounting
 *     releases them (it must stop);
 *   - while the show plays, the frame loop draws from getLevelSource()'s
 *     answer, so a source that moves reaches the canvas.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const levels = vi.hoisted(() => ({
  retain: vi.fn(),
  release: vi.fn(),
  reads: 0,
  source: null as unknown,
}));

vi.mock("@/audio/levels", () => ({
  retainLevels: () => {
    levels.retain();
    return levels.release;
  },
  getLevelSource: () => levels.source,
}));

const { Oscilloscope } = await import("@/components/player/Oscilloscope");
const { usePlayerStore } = await import("@/stores/player-store");

/** A canvas context that does nothing: jsdom has none. */
const ctxStub = new Proxy({}, { get: (_t, k) => (k === "canvas" ? null : () => ({ addColorStop() {} })), set: () => true });

// jsdom has neither.
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  levels.retain.mockReset();
  levels.release.mockReset();
  levels.reads = 0;
  levels.source = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteTimeDomainData: (a: Uint8Array) => {
      levels.reads++;
      a.fill(200);
    },
    getByteFrequencyData: (a: Uint8Array) => {
      levels.reads++;
      a.fill(200);
    },
    getFloatTimeDomainData: () => {},
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctxStub as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 300, height: 200 } as DOMRect);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  usePlayerStore.setState({ playing: false });
  vi.restoreAllMocks();
});

const frames = () => act(() => new Promise((r) => setTimeout(r, 120)));

describe("useOscilloscope reads levels.ts", () => {
  it("retains the levels while mounted and releases them on unmount", async () => {
    act(() => root.render(createElement(Oscilloscope)));
    expect(levels.retain).toHaveBeenCalledTimes(1);
    expect(levels.release).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(levels.release).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("draws from getLevelSource() while the show plays, and not while paused", async () => {
    act(() => root.render(createElement(Oscilloscope)));
    await frames();
    expect(levels.reads).toBe(0);
    act(() => usePlayerStore.setState({ playing: true }));
    await frames();
    expect(levels.reads).toBeGreaterThan(0);
  });

  it("with no source (the bridge, nothing loaded) it draws idle and reads nothing", async () => {
    levels.source = null;
    act(() => root.render(createElement(Oscilloscope)));
    act(() => usePlayerStore.setState({ playing: true }));
    await frames();
    expect(levels.reads).toBe(0);
  });
});
