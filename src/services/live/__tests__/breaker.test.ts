// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BREAKER_CLIENTS, BREAKER_WINDOW_MS, createBreaker, pickReplacement, type StationFailure } from "../breaker";
import type { ProgramSlot } from "@/lib/live/schedule";

/**
 * The station's circuit breaker: three listeners tuned in to the show on the
 * air, failing on it within two minutes, cut it. One phone pressing Try Again,
 * a browser refusing sound, or failures on another show never do.
 */

const slot = { start: 1_000_000, end: 9_000_000, fileHash: "archive:coll:a.mp3", episodeId: "ep-a" } as ProgramSlot;

function setup() {
  const trip = vi.fn(async () => {});
  const breaker = createBreaker({ onAir: async () => slot, trip });
  const fail = (client: string, at: number, over: Partial<StationFailure> = {}) =>
    breaker.note({ episodeId: "ep-a", client, kind: "decode-error", recovered: false, live: true, at, ...over });
  return { breaker, trip, fail };
}

describe("the station's breaker", () => {
  it(`trips at ${BREAKER_CLIENTS} distinct clients within the window, once`, async () => {
    const { trip, fail } = setup();
    expect(await fail("1.1.1.1", 2_000_000)).toBeNull();
    expect(await fail("2.2.2.2", 2_010_000)).toBeNull();
    const t = await fail("3.3.3.3", 2_020_000, { kind: "stall" });
    expect(t).toMatchObject({ slot, clients: 3, kinds: ["decode-error", "stall"] });
    expect(trip).toHaveBeenCalledTimes(1);
    // A fourth failure on the same airing does not trip it again.
    expect(await fail("4.4.4.4", 2_030_000)).toBeNull();
    expect(trip).toHaveBeenCalledTimes(1);
  });

  it("one client failing many times is one client", async () => {
    const { breaker, trip, fail } = setup();
    for (let i = 0; i < 30; i++) await fail("1.1.1.1", 2_000_000 + i * 1000);
    expect(breaker.count(slot, 2_030_000)).toBe(1);
    expect(trip).not.toHaveBeenCalled();
  });

  it("failures further apart than the window do not add up", async () => {
    const { trip, fail } = setup();
    await fail("1.1.1.1", 2_000_000);
    await fail("2.2.2.2", 2_000_000 + BREAKER_WINDOW_MS / 2);
    await fail("3.3.3.3", 2_000_000 + BREAKER_WINDOW_MS + 1);
    expect(trip).not.toHaveBeenCalled();
  });

  it("ignores the phone's refusals, rescued failures, untuned tabs and other shows", async () => {
    const { breaker, trip, fail } = setup();
    await fail("1.1.1.1", 2_000_000, { kind: "play-rejected" });
    await fail("2.2.2.2", 2_000_000, { kind: "handover-rejected" });
    await fail("3.3.3.3", 2_000_000, { recovered: true });
    await fail("4.4.4.4", 2_000_000, { live: false });
    await fail("5.5.5.5", 2_000_000, { episodeId: "ep-b" });
    expect(breaker.count(slot, 2_000_000)).toBe(0);
    expect(trip).not.toHaveBeenCalled();
    // Control: three that count do trip it.
    for (const c of ["6", "7", "8"]) await fail(c, 2_000_001);
    expect(trip).toHaveBeenCalledTimes(1);
  });

  it("holds no client key in the clear", async () => {
    const trip = vi.fn(async () => {});
    const breaker = createBreaker({ onAir: async () => slot, trip, clients: 2 });
    await breaker.note({ episodeId: "ep-a", client: "203.0.113.9", kind: "stall", recovered: false, live: true, at: 2_000_000 });
    await breaker.note({ episodeId: "ep-a", client: "198.51.100.7", kind: "stall", recovered: false, live: true, at: 2_000_001 });
    expect(JSON.stringify(trip.mock.calls)).not.toMatch(/203\.0\.113|198\.51\.100/);
  });
});

describe("pickReplacement", () => {
  const ranking = ["bad", "failing", "unwalked", "a", "b", "c"];
  const ok = new Set(["failing", "a", "b", "c"]);
  const bad = new Set(["bad"]);

  it("never the failing file, a known-bad one or an unwalked one", () => {
    expect(pickReplacement(ranking, "failing", ok, bad, null, new Set())).toBe("a");
  });
  it("pinned and not on today's program first, then pinned, then off today", () => {
    expect(pickReplacement(ranking, "failing", ok, bad, new Set(["b", "c"]), new Set(["b"]))).toBe("c");
    expect(pickReplacement(ranking, "failing", ok, bad, new Set(["b"]), new Set(["b"]))).toBe("b");
    expect(pickReplacement(ranking, "failing", ok, bad, null, new Set(["a"]))).toBe("b");
  });
  it("null when nothing passed a walk", () => {
    expect(pickReplacement(ranking, "failing", new Set(["failing"]), bad, null, new Set())).toBeNull();
  });
});
