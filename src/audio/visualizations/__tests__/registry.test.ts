import { describe, it, expect } from "vitest";
import {
  VISUALIZATIONS,
  getVisualization,
  nextVisualization,
} from "../index";

describe("visualization registry", () => {
  it("exports all 8 visualizations", () => {
    expect(VISUALIZATIONS).toHaveLength(8);
  });

  it("each has required properties", () => {
    for (const viz of VISUALIZATIONS) {
      expect(typeof viz.id).toBe("string");
      expect(typeof viz.name).toBe("string");
      expect(typeof viz.draw).toBe("function");
      expect(typeof viz.drawIdle).toBe("function");
    }
  });

  it("has unique ids", () => {
    const ids = VISUALIZATIONS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getVisualization returns correct viz", () => {
    const viz = getVisualization("oscilloscope");
    expect(viz.id).toBe("oscilloscope");
    expect(viz.name).toBe("Oscilloscope");
  });

  it("getVisualization returns first for unknown id", () => {
    const viz = getVisualization("nonexistent");
    expect(viz.id).toBe(VISUALIZATIONS[0].id);
  });

  it("nextVisualization cycles forward", () => {
    const next = nextVisualization("oscilloscope");
    expect(next.id).toBe("bars");
  });

  it("nextVisualization wraps from last to first", () => {
    const last = VISUALIZATIONS[VISUALIZATIONS.length - 1];
    const next = nextVisualization(last.id);
    expect(next.id).toBe(VISUALIZATIONS[0].id);
  });
});
