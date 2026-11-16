import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ENVELOPE_OFFSET_SEC,
  ENVELOPE_PARAMS,
  decodeEnvelope,
  delayRises,
  encodeEnvelope,
  holdDips,
  levelEnvelope,
  gainAt,
  gainEnvelope,
  gaussian,
  minimumFilter,
  packEnvelope,
  percentile,
  slewLimit,
  unpackEnvelope,
} from "../level-envelope";

const ref = JSON.parse(readFileSync(path.join(__dirname, "fixtures/envelope-ref.json"), "utf8")) as {
  clips: Record<string, { L: number[]; g: number[] }>;
};

describe("gainEnvelope is the prototype's gain_envelope", () => {
  for (const [name, { L, g }] of Object.entries(ref.clips)) {
    it(`matches envelope.py on ${name} (two real clips, Jackson's parameters)`, () => {
      const out = gainEnvelope(L);
      expect(out.length).toBe(g.length);
      let worst = 0;
      for (let i = 0; i < g.length; i++) worst = Math.max(worst, Math.abs(out[i] - g[i]));
      // L was rounded to 6 decimals for the fixture; the port itself agrees to 1e-14.
      expect(worst).toBeLessThan(1e-3);
    });
  }

  it("is not flat: the clips really are levelled (a constant envelope would not match)", () => {
    const g = gainEnvelope(ref.clips["caller-guest-1998-12-01"].L);
    expect(Math.max(...g) - Math.min(...g)).toBeGreaterThan(3);
  });

  it("never moves faster than 24 dB/s, and stays inside +18 / -12 dB", () => {
    for (const { L } of Object.values(ref.clips)) {
      const g = gainEnvelope(L);
      for (let i = 1; i < g.length; i++) expect(Math.abs(g[i] - g[i - 1])).toBeLessThanOrEqual(ENVELOPE_PARAMS.maxSlew * 0.1 + 1e-9);
      for (const v of g) {
        expect(v).toBeLessThanOrEqual(ENVELOPE_PARAMS.maxBoost + 1e-9);
        expect(v).toBeGreaterThanOrEqual(-ENVELOPE_PARAMS.maxCut - 1e-9);
      }
    }
  });

  it("brings a quiet talker up to the target and a loud one down", () => {
    const quiet = new Array(300).fill(-30);
    const loud = new Array(300).fill(-10);
    expect(gainEnvelope([...quiet, ...quiet])[300]).toBeCloseTo(12, 1);
    expect(gainEnvelope([...loud, ...loud])[300]).toBeCloseTo(-8, 1);
  });

  it("never lifts a pause above the talk around it", () => {
    // Talk at -24 (gain +6), a 2 s pause at -70, talk at -24 again.
    const L = [...new Array(100).fill(-24), ...new Array(20).fill(-70), ...new Array(100).fill(-24)];
    const g = gainEnvelope(L);
    for (let i = 100; i < 120; i++) expect(g[i]).toBeLessThanOrEqual(6 + 1e-6);
  });

  it("returns zeros for a file with no talk at all", () => {
    expect(Array.from(gainEnvelope(new Array(50).fill(-120.7)))).toEqual(new Array(50).fill(0));
  });
});

describe("the gap after a talker (ours, after the prototype)", () => {
  it("holdDips: the gain may not rise through a dip, then catches up at the slew limit", () => {
    // Talk, a 0.4 s dip 20 dB down, talk; the gain wants to climb throughout.
    const L = [...new Array(20).fill(-20), ...new Array(4).fill(-40), ...new Array(20).fill(-20)];
    const g = L.map((_, i) => i * 0.5);
    const h = holdDips(g, L, 8, 24);
    for (let i = 21; i < 24; i++) expect(h[i]).toBe(h[20]);
    for (let i = 1; i < h.length; i++) expect(h[i] - h[i - 1]).toBeLessThanOrEqual(2.4 + 1e-9);
    for (let i = 0; i < h.length; i++) expect(h[i]).toBeLessThanOrEqual(g[i]);
    expect(h[h.length - 1]).toBe(g[g.length - 1]);
  });

  it("levelEnvelope holds the gain still through a short gap that the prototype rises across", () => {
    // A loud talker, a 0.5 s gap, a quieter one: too short to be a pause.
    const L = [...new Array(60).fill(-14), ...new Array(5).fill(-45), ...new Array(60).fill(-26)];
    const g = gainEnvelope(L);
    const d = levelEnvelope(L);
    expect(g[66] - g[59]).toBeGreaterThan(1); // the prototype is rising by the gap's end
    for (let i = 60; i <= 66; i++) expect(d[i]).toBeLessThanOrEqual(d[59] + 0.1);
  });
});

describe("a rise arrives late (ours, after the prototype)", () => {
  it("a fall still starts on time; a rise waits half a second", () => {
    const g = [0, 0, 0, -6, -6, -6, -6, -6, -6, -6, 6, 6, 6, 6, 6, 6, 6, 6];
    const d = delayRises(g, 0.5);
    expect(d[3]).toBe(-6); // the fall, on time
    expect(Array.from(d.slice(10, 15))).toEqual([-6, -6, -6, -6, -6]); // the rise, held 5 frames
    expect(d[15]).toBe(6);
  });

  it("levelEnvelope delays the rise (0.3 s): a loud talker then a quiet one, the rise starts later than the prototype's", () => {
    // (-28: inside the 20 dB talk window, so a talker, not a pause)
    const L = [...new Array(100).fill(-10), ...new Array(100).fill(-28)];
    const g = gainEnvelope(L);
    const d = levelEnvelope(L);
    let lower = 0;
    for (let i = 0; i < L.length; i++) lower = Math.max(lower, g[i] - d[i]);
    expect(lower).toBeGreaterThan(2);
    expect(d[199]).toBeCloseTo(g[199], 6); // and it gets there
  });

  it("only ever lowers the gain, and keeps the slew limit", () => {
    for (const { L } of Object.values(ref.clips)) {
      const g = gainEnvelope(L);
      const d = levelEnvelope(L);
      for (let i = 0; i < g.length; i++) expect(d[i]).toBeLessThanOrEqual(g[i]);
      for (let i = 1; i < d.length; i++) expect(Math.abs(d[i] - d[i - 1])).toBeLessThanOrEqual(ENVELOPE_PARAMS.maxSlew * 0.1 + 1e-9);
    }
  });
});

describe("the scipy pieces", () => {
  it("gaussian keeps a constant constant and spreads an impulse symmetrically", () => {
    expect(Array.from(gaussian([2, 2, 2, 2, 2], 1)).every((v) => Math.abs(v - 2) < 1e-12)).toBe(true);
    const g = gaussian([0, 0, 0, 1, 0, 0, 0], 1);
    expect(g[2]).toBeCloseTo(g[4], 12);
    expect(g[3]).toBeGreaterThan(g[2]);
  });

  it("minimumFilter leans left for an even size, as scipy's does", () => {
    // size 4: window [i-2, i+1]
    expect(Array.from(minimumFilter([5, 4, 3, 2, 1, 0], 4))).toEqual([4, 3, 2, 1, 0, 0]);
    expect(Array.from(minimumFilter([0, 1, 2, 3, 4, 5], 4))).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it("slewLimit bounds every step", () => {
    const m = slewLimit([0, 10, 0, 10], 1);
    for (let i = 1; i < m.length; i++) expect(Math.abs(m[i] - m[i - 1])).toBeLessThanOrEqual(1 + 1e-12);
  });

  it("percentile interpolates linearly, as numpy's does", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 0], 95)).toBeCloseTo(9.5, 12);
  });
});

describe("storage and the wire", () => {
  it("int8 in 0.25 dB steps, clamped", () => {
    expect(Array.from(encodeEnvelope([0, 0.26, -12, 18, 40, -40]))).toEqual([0, 1, -48, 72, 127, -128]);
    expect(Array.from(decodeEnvelope(new Int8Array([4, -8])))).toEqual([1, -2]);
  });

  it("packs and unpacks", () => {
    const e = unpackEnvelope(packEnvelope(new Int8Array([0, 4, 8])))!;
    expect(e.hopSec).toBe(0.1);
    expect(e.offsetSec).toBe(ENVELOPE_OFFSET_SEC);
    expect(Array.from(e.gainDb)).toEqual([0, 1, 2]);
  });

  it("refuses anything else", () => {
    expect(unpackEnvelope(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
    expect(unpackEnvelope(new Uint8Array(4))).toBeNull();
  });

  it("gainAt interpolates between frame centres and holds at the ends", () => {
    const e = unpackEnvelope(packEnvelope(new Int8Array([0, 8, 16])))!;
    expect(gainAt(e, 0)).toBe(0);
    expect(gainAt(e, 0.25)).toBeCloseTo(1, 9);
    expect(gainAt(e, 0.3)).toBeCloseTo(2, 9);
    expect(gainAt(e, 99)).toBe(4);
  });
});
