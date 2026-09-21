import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createScanPreview, PREVIEW_WINDOW_MS, PREVIEW_VOLUME, previewOffset } from "../scan-preview";
import { makeMediaElement, setReadyState } from "@/hooks/__tests__/support/mount-player";

/**
 * The radio dial's scan preview (HD-014). Rapid scanning is the whole use case:
 * the dial sweeps, a preview starts, the dial moves on and the next one starts
 * while the last one's timers are still pending. Every preview must get its
 * full window, and nothing may be stopped with `src = ""`.
 */

let made: HTMLAudioElement[];

function newElement(): HTMLAudioElement {
  const el = makeMediaElement();
  Object.defineProperty(el, "volume", { value: 0, writable: true, configurable: true });
  made.push(el);
  return el;
}

const ep = (n: number) => ({ sourceUrl: `https://archive.org/download/coll/p${n}.mp3`, duration: 10_800 });

beforeEach(() => {
  vi.useFakeTimers();
  made = [];
});

afterEach(() => {
  vi.useRealTimers();
});

async function started(p: Promise<void>): Promise<void> {
  await p;
  await Promise.resolve();
}

describe("scan preview", () => {
  it("rapid dial scanning plays each preview for its full window", async () => {
    const preview = createScanPreview(newElement, () => 0.5);

    await started(preview.start(ep(1)));
    vi.advanceTimersByTime(PREVIEW_WINDOW_MS - 500); // A is 2s in
    await started(preview.start(ep(2))); // the dial moves on
    const [a, b] = made;
    expect(a.paused).toBe(true); // A stopped at once

    // A's old fade-out timer was due 500ms from here. It used to fire on
    // schedule and fade out whatever was current — B, 0.5s into its window.
    vi.advanceTimersByTime(PREVIEW_WINDOW_MS - 100);
    expect(b.paused).toBe(false);
    expect(b.volume).toBeCloseTo(PREVIEW_VOLUME, 5);

    // B's own window ends, and B fades out and is released.
    vi.advanceTimersByTime(100 + 1000);
    expect(b.paused).toBe(true);
    expect(b.getAttribute("src")).toBeNull();
  });

  it("clears the previous preview's fade-in, so it cannot keep raising a dead element", async () => {
    const preview = createScanPreview(newElement, () => 0.5);
    await started(preview.start(ep(1)));
    vi.advanceTimersByTime(30); // fade-in under way
    await started(preview.start(ep(2)));
    const [a] = made;
    const volumeAtStop = a.volume;
    vi.advanceTimersByTime(1000);
    expect(a.volume).toBe(volumeAtStop);
  });

  it("stops elements with removeAttribute + load, never src = \"\"", async () => {
    const preview = createScanPreview(newElement, () => 0.5);
    await started(preview.start(ep(1)));
    const [a] = made;
    const setSrc = vi.fn();
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
    Object.defineProperty(a, "src", {
      configurable: true,
      get: () => desc.get!.call(a),
      set: (v: string) => {
        setSrc(v);
        desc.set!.call(a, v);
      },
    });
    const load = vi.spyOn(a, "load");

    preview.stop();
    vi.advanceTimersByTime(1000);

    expect(setSrc).not.toHaveBeenCalledWith("");
    expect(a.hasAttribute("src")).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it("seeks on loadedmetadata, not before the element has a timeline", async () => {
    const preview = createScanPreview(newElement, () => 0.5);
    await started(preview.start(ep(1)));
    const [a] = made;
    const offset = previewOffset(10_800, () => 0.5);
    a.currentTime = 0; // whatever an early write did, the load reset it
    setReadyState(a, 1);
    a.dispatchEvent(new Event("loadedmetadata"));
    expect(a.currentTime).toBe(offset);
  });

  it("a preview superseded while its play() is pending never fades in", async () => {
    let resolveA!: () => void;
    const slow = () => {
      const el = makeMediaElement(() => new Promise<void>((r) => (resolveA = r)));
      Object.defineProperty(el, "volume", { value: 0, writable: true, configurable: true });
      made.push(el);
      return el;
    };
    let first = true;
    const preview = createScanPreview(() => (first ? ((first = false), slow()) : newElement()), () => 0.5);
    const pA = preview.start(ep(1));
    await started(preview.start(ep(2)));
    resolveA();
    await pA;
    vi.advanceTimersByTime(500);
    expect(made[0].volume).toBe(0);
  });
});
