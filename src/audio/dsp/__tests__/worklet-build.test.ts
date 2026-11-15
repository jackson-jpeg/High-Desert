import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROCESSOR_NAME } from "@/audio/processing";
import { build, OUT } from "../../../../scripts/audio/build-worklet.mjs";

/**
 * public/audio/dsp-worklet.js is committed (the deploy has no build step for
 * public/), so it must be exactly what src/audio/dsp/ builds to: a DSP fix
 * that was never rebuilt would ship the old sound while every test of the
 * source passed.
 */
describe("dsp-worklet.js", () => {
  it("is a fresh build of src/audio/dsp/ (run node scripts/audio/build-worklet.mjs)", () => {
    expect(readFileSync(OUT, "utf8") === build()).toBe(true);
  });

  it("registers the processor the page asks for, and loads as a classic script", () => {
    const js = readFileSync(OUT, "utf8");
    const name = /const PROCESSOR_NAME = "([^"]+)"/.exec(js)?.[1];
    expect(name).toBe(PROCESSOR_NAME);
    expect(js).toMatch(/registerProcessor\(PROCESSOR_NAME, /);
    expect(js).not.toMatch(/^\s*(import|export)\s/m);
  });
});
