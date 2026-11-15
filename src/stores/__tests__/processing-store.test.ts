import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CLEANUP,
  DEFAULT_LEVEL,
  DSP_STORAGE_KEY,
  UNAVAILABLE_REASON,
  readSaved,
  switchesUsable,
  useProcessingStore,
} from "@/stores/processing-store";

/**
 * Level and Clean up's switches: remembered per listener, read after mount,
 * defaults Level on and Clean up off (docs/audio-processing/README.md).
 */

function reset() {
  localStorage.clear();
  useProcessingStore.setState({ level: DEFAULT_LEVEL, cleanup: DEFAULT_CLEANUP, availability: "pending", meter: null, hydrated: false });
}

describe("processing store", () => {
  beforeEach(reset);

  it("defaults: Level on, Clean up off", () => {
    expect(DEFAULT_LEVEL).toBe(true);
    expect(DEFAULT_CLEANUP).toBe(false);
    expect(readSaved()).toEqual({ level: true, cleanup: false });
  });

  it("remembers a change in localStorage, and hydrate() brings it back", () => {
    useProcessingStore.getState().setLevel(false);
    useProcessingStore.getState().setCleanup(true);
    expect(JSON.parse(localStorage.getItem(DSP_STORAGE_KEY)!)).toEqual({ level: false, cleanup: true });
    // A new page: the store starts from the defaults, then reads the choice.
    useProcessingStore.setState({ level: true, cleanup: false, hydrated: false });
    useProcessingStore.getState().hydrate();
    expect(useProcessingStore.getState()).toMatchObject({ level: false, cleanup: true, hydrated: true });
  });

  it("does not read storage until hydrate() (no hydration mismatch)", () => {
    localStorage.setItem(DSP_STORAGE_KEY, JSON.stringify({ level: false, cleanup: true }));
    expect(useProcessingStore.getState()).toMatchObject({ level: true, cleanup: false, hydrated: false });
  });

  it("hydrates once: a later hydrate() does not undo a switch flipped since", () => {
    useProcessingStore.getState().hydrate();
    useProcessingStore.setState({ cleanup: true });
    localStorage.setItem(DSP_STORAGE_KEY, JSON.stringify({ level: true, cleanup: false }));
    useProcessingStore.getState().hydrate();
    expect(useProcessingStore.getState().cleanup).toBe(true);
  });

  it("falls back to the defaults on garbage, field by field", () => {
    localStorage.setItem(DSP_STORAGE_KEY, "{not json");
    expect(readSaved()).toEqual({ level: true, cleanup: false });
    localStorage.setItem(DSP_STORAGE_KEY, JSON.stringify({ level: "no", cleanup: true }));
    expect(readSaved()).toEqual({ level: true, cleanup: true });
  });

  it("switches are usable only while pending or ok", () => {
    expect(switchesUsable("ok")).toBe(true);
    expect(switchesUsable("pending")).toBe(true);
    for (const a of ["ios", "unsupported", "failed"] as const) expect(switchesUsable(a)).toBe(false);
  });

  it("every reason is one line with no em dash", () => {
    for (const r of Object.values(UNAVAILABLE_REASON)) {
      expect(r).not.toMatch(/—/);
      expect(r).not.toMatch(/\n/);
      expect(r.length).toBeLessThan(60);
    }
  });
});
