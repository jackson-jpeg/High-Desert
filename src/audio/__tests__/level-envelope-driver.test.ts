import { beforeEach, describe, expect, it, vi } from "vitest";
import { packEnvelope, unpackEnvelope } from "@/lib/audio/level-envelope";
import {
  HORIZON_SEC,
  MISS_RETRY_MS,
  __resetEnvelopeCache,
  envelopeIfLoaded,
  loadEnvelope,
  rampTo,
  scheduleEnvelope,
} from "../level-envelope-driver";

function fakeParam() {
  const calls: [string, number, number?][] = [];
  return {
    calls,
    value: 1,
    cancelScheduledValues: (t: number) => calls.push(["cancel", t]),
    setValueAtTime: (v: number, t: number) => calls.push(["set", v, t]),
    linearRampToValueAtTime: (v: number, t: number) => calls.push(["ramp", v, t]),
  };
}

// 0, 6, 12, 18 ... dB at 0.2, 0.3, 0.4 ... s
const env = unpackEnvelope(packEnvelope(Int8Array.from({ length: 100 }, (_, i) => Math.min(72, i * 24))))!;
const lin = (db: number) => Math.pow(10, db / 20);

describe("scheduleEnvelope", () => {
  it("starts from the gain at the element's position, now", () => {
    const p = fakeParam();
    const g = scheduleEnvelope(p, env, { now: 10, pos: 0.25, rate: 1, playing: true });
    expect(g).toBeCloseTo(3, 9);
    expect(p.calls[0]).toEqual(["cancel", 10]);
    expect(p.calls[1][0]).toBe("set");
    expect(p.calls[1][1]).toBeCloseTo(lin(3), 9);
    expect(p.calls[1][2]).toBe(10);
  });

  it("ramps to each later point at context time now + (t - pos) / rate", () => {
    const p = fakeParam();
    scheduleEnvelope(p, env, { now: 10, pos: 0.25, rate: 2, playing: true });
    const ramps = p.calls.filter((c) => c[0] === "ramp");
    // first point after 0.25 s is frame 1 at 0.3 s: (0.3 - 0.25) / 2
    expect(ramps[0][1]).toBeCloseTo(lin(6), 9);
    expect(ramps[0][2]).toBeCloseTo(10.025, 9);
    // and never past the horizon (in file time, at rate 2)
    const lastFile = 0.25 + (ramps[ramps.length - 1][2]! - 10) * 2;
    expect(lastFile).toBeLessThanOrEqual(0.25 + HORIZON_SEC * 2 + 1e-9);
    expect(ramps.length).toBeGreaterThan(30);
  });

  it("paused: holds the gain at the position, no ramps", () => {
    const p = fakeParam();
    scheduleEnvelope(p, env, { now: 3, pos: 0.4, rate: 1, playing: false });
    expect(p.calls.filter((c) => c[0] === "ramp")).toEqual([]);
    expect(p.calls[1][1]).toBeCloseTo(lin(12), 9);
  });
});

describe("rampTo", () => {
  it("ramps from where the gain is now", () => {
    const p = fakeParam();
    p.value = 0.5;
    rampTo(p, 6, 2);
    expect(p.calls).toEqual([
      ["cancel", 2],
      ["set", 0.5, 2],
      ["ramp", lin(6), 2.3],
    ]);
  });
});

describe("loadEnvelope", () => {
  beforeEach(() => __resetEnvelopeCache());

  it("fetches once and serves it synchronously after", async () => {
    const body = packEnvelope(new Int8Array([4, 4]));
    const f = vi.fn(async (_u: string) => new Response(body as unknown as BodyInit));
    expect(envelopeIfLoaded("a--b")).toBeNull();
    const e = await loadEnvelope("a--b", f as unknown as typeof fetch);
    expect(e?.gainDb[0]).toBe(1);
    await loadEnvelope("a--b", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("/api/level/envelope?key=a--b");
    expect(envelopeIfLoaded("a--b")?.gainDb[1]).toBe(1);
  });

  it("a show with no envelope yet: null (the live leveler), asked again later", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 404 }));
    const t = Date.now();
    expect(await loadEnvelope("x--y", f as unknown as typeof fetch, t)).toBeNull();
    expect(await loadEnvelope("x--y", f as unknown as typeof fetch, t + 1000)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    await loadEnvelope("x--y", f as unknown as typeof fetch, t + MISS_RETRY_MS + 1000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a network failure is a miss, never a throw", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await loadEnvelope("n--k", f as unknown as typeof fetch)).toBeNull();
  });
});
