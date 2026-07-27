import { describe, it, expect } from "vitest";
import {
  VISUALIZATION_META,
  getVisualization,
  getVizName,
  nextVisualization,
  ensureVisualization,
} from "../index";

/*
 * The registry used to export a `VISUALIZATIONS` array of fully-loaded
 * renderers. Six of the eight are now loaded on demand, so the eager surface is
 * metadata only. These tests keep the same guarantees — eight entries, unique
 * ids, correct cycling — and additionally assert that every id really does
 * resolve to a working renderer, which the old shape got for free.
 */
describe("visualization registry", () => {
  it("exposes metadata for all 8 visualizations", () => {
    expect(VISUALIZATION_META).toHaveLength(8);
  });

  it("metadata entries are well formed", () => {
    for (const meta of VISUALIZATION_META) {
      expect(typeof meta.id).toBe("string");
      expect(meta.id.length).toBeGreaterThan(0);
      expect(typeof meta.name).toBe("string");
      expect(meta.name.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = VISUALIZATION_META.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id loads a renderer with the full drawing contract", async () => {
    for (const meta of VISUALIZATION_META) {
      const viz = await ensureVisualization(meta.id);
      expect(viz.id).toBe(meta.id);
      expect(typeof viz.draw).toBe("function");
      expect(typeof viz.drawIdle).toBe("function");
    }
  });

  it("getVisualization returns the default synchronously for a lazy id", () => {
    // `radar` is lazy, so before it has loaded the draw loop must still get a
    // usable renderer rather than undefined.
    const viz = getVisualization("radar");
    expect(typeof viz.draw).toBe("function");
    expect(typeof viz.drawIdle).toBe("function");
  });

  it("getVisualization returns the real renderer once loaded", async () => {
    await ensureVisualization("radar");
    expect(getVisualization("radar").id).toBe("radar");
  });

  it("getVisualization returns the default for an unknown id", () => {
    expect(getVisualization("nonexistent").id).toBe(VISUALIZATION_META[0].id);
  });

  it("ensureVisualization resolves to the default for an unknown id", async () => {
    const viz = await ensureVisualization("nonexistent");
    expect(viz.id).toBe(VISUALIZATION_META[0].id);
  });

  it("getVizName resolves without loading the renderer", () => {
    expect(getVizName("vu")).toBe("VU Meter");
    expect(getVizName("nonexistent")).toBe(VISUALIZATION_META[0].name);
  });

  it("nextVisualization cycles forward", () => {
    expect(nextVisualization("oscilloscope").id).toBe("bars");
  });

  it("nextVisualization wraps from last to first", () => {
    const last = VISUALIZATION_META[VISUALIZATION_META.length - 1];
    expect(nextVisualization(last.id).id).toBe(VISUALIZATION_META[0].id);
  });
});
