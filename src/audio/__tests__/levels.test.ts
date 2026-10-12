/**
 * src/audio/levels.ts decides where the visualizers' levels come from. On iOS
 * it must never ask the engine for its analyser: that path routes the playing
 * element through Web Audio, which stops the show on the lock screen. Every
 * other device keeps the engine's analyser, exactly as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({
  analyser: { fftSize: 2048, frequencyBinCount: 1024 } as unknown,
  getAnalyserNode: vi.fn(),
  state: null as null | Record<string, unknown>,
}));
const platform = vi.hoisted(() => ({ ios: false }));

vi.mock("@/audio/engine", () => ({
  getAnalyserNode: engine.getAnalyserNode,
  engineState: () => engine.state,
  isBridging: () => false,
  onEngineEvent: () => () => {},
}));
vi.mock("@/lib/utils/platform", () => ({ isIOSDevice: () => platform.ios }));

afterEach(() => {
  vi.resetModules();
  engine.getAnalyserNode.mockReset();
  engine.state = null;
});

describe("getLevelSource", () => {
  it("not iOS: the engine's analyser, and no tap", async () => {
    platform.ios = false;
    engine.getAnalyserNode.mockReturnValue(engine.analyser);
    const { getLevelSource, usesLevelTap } = await import("@/audio/levels");
    expect(usesLevelTap()).toBe(false);
    expect(getLevelSource()).toBe(engine.analyser);
  });

  it("iOS: the level tap, and the engine's analyser is never asked for", async () => {
    platform.ios = true;
    engine.state = { src: "https://archive.org/download/c/s.mp3", currentTime: 10, duration: 100, paused: false, readyState: 4 };
    const { getLevelSource, retainLevels, usesLevelTap } = await import("@/audio/levels");
    const { LevelTap } = await import("@/audio/level-tap/tap");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    const release = retainLevels();
    const source = getLevelSource();
    expect(usesLevelTap()).toBe(true);
    expect(source).toBeInstanceOf(LevelTap);
    expect(engine.getAnalyserNode).not.toHaveBeenCalled();
    // It reads the show's own URL, with a Range, CORS, no credentials.
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://archive.org/download/c/s.mp3",
      expect.objectContaining({ headers: { Range: "bytes=0-" }, mode: "cors", credentials: "omit" }),
    );
    release();
    fetchSpy.mockRestore();
  });

  it("iOS with nothing on the element: nothing to show", async () => {
    platform.ios = true;
    const { getLevelSource } = await import("@/audio/levels");
    expect(getLevelSource()).toBeNull();
    expect(engine.getAnalyserNode).not.toHaveBeenCalled();
  });
});
