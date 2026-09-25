// @vitest-environment node
import { describe, it, expect } from "vitest";
import { bestEstimate, sampleOffset, syncClock, type ClockSample } from "../time-sync";
import { stationOffsetSec } from "@/audio/live-controller";

/**
 * Everyone tuned in hears the same second. The only shared reference is the
 * server's clock; these tests simulate browsers whose clocks are wrong by tens
 * of seconds, on networks whose delays are lopsided, and hold what they would
 * play to within a second of each other.
 */

describe("the time sync estimator", () => {
  it("keeps the sample with the smallest round trip, not the average", () => {
    const samples: ClockSample[] = [
      // 900 ms round trip, all of it on the way back: offset reads 450 ms off.
      { t0: 1000, t1: 1900, server: 1000 + 5000 },
      // 20 ms round trip: good to ±10 ms.
      { t0: 3000, t1: 3020, server: 3010 + 5000 },
      { t0: 5000, t1: 5300, server: 5050 + 5000 },
    ];
    const est = bestEstimate(samples)!;
    expect(est.rttMs).toBe(20);
    expect(est.offsetMs).toBe(5000);
    expect(est.offsetMs).toBe(sampleOffset(samples[1]));
    // The mean would have been dragged off by the slow sample.
    const mean = samples.reduce((a, s) => a + sampleOffset(s), 0) / samples.length;
    expect(Math.abs(mean - 5000)).toBeGreaterThan(100);
  });

  it("ignores samples that cannot be right, and says so when none can", () => {
    expect(bestEstimate([])).toBeNull();
    expect(bestEstimate([{ t0: 10, t1: 5, server: 100 }])).toBeNull();
    expect(bestEstimate([{ t0: 10, t1: 5, server: 100 }, { t0: 0, t1: 50, server: 125 }])).toEqual({
      offsetMs: 100,
      rttMs: 50,
    });
  });

  it("samples in sequence and survives a lost request", async () => {
    let t = 0;
    let n = 0;
    const est = await syncClock(
      async () => {
        n += 1;
        t += 30;
        if (n === 2) throw new Error("lost");
        return t + 1_000; // server is 1 s ahead, stamped mid-trip
      },
      { n: 4, now: () => (t += 0) },
    );
    expect(n).toBe(4);
    expect(est).not.toBeNull();
  });
});

/**
 * A browser on a simulated network. `trueNow` is real time (and the server's
 * clock, which is correct by definition here); the browser's clock is off by
 * `skewMs`, and each request spends `up` ms reaching the server and `down` ms
 * coming back.
 */
function browser(skewMs: number, trips: [number, number][]) {
  let trueNow = 1_000_000;
  let i = 0;
  const local = () => trueNow + skewMs;
  const fetchServerNow = async () => {
    const [up, down] = trips[i++ % trips.length];
    trueNow += up;
    const stamped = trueNow;
    trueNow += down;
    return stamped;
  };
  return {
    local,
    fetchServerNow,
    advanceTo(t: number) {
      trueNow = t;
    },
    get trueNow() {
      return trueNow;
    },
  };
}

describe("two listeners land on the same second", () => {
  // A show that started 47 minutes before the instant both browsers tune in.
  const slot = { start: 5_000_000 - 47 * 60_000 };

  it("within 1 s, with clocks a minute apart and lopsided networks", async () => {
    // A: clock 37 s fast, a phone on a congested uplink.
    const a = browser(37_000, [
      [400, 60],
      [120, 900],
      [35, 40],
      [250, 250],
      [600, 30],
    ]);
    // B: clock 22 s slow, a desktop close to the server.
    const b = browser(-22_000, [
      [12, 9],
      [8, 30],
      [150, 10],
      [10, 11],
      [9, 8],
    ]);
    const estA = (await syncClock(a.fetchServerNow, { now: a.local }))!;
    const estB = (await syncClock(b.fetchServerNow, { now: b.local }))!;

    // Both tune in at the same real instant.
    a.advanceTo(5_000_000);
    b.advanceTo(5_000_000);
    const landA = stationOffsetSec(slot, a.local() + estA.offsetMs);
    const landB = stationOffsetSec(slot, b.local() + estB.offsetMs);

    expect(Math.abs(landA - landB)).toBeLessThan(1);
    // And both are where the station really is.
    expect(Math.abs(landA - 47 * 60)).toBeLessThan(1);
    expect(Math.abs(landB - 47 * 60)).toBeLessThan(1);

    // Control: on their own clocks they would be 59 s apart.
    const rawA = stationOffsetSec(slot, a.local());
    const rawB = stationOffsetSec(slot, b.local());
    expect(Math.abs(rawA - rawB)).toBeGreaterThan(58);
  });

  it("the error is bounded by half the best round trip", async () => {
    const c = browser(-90_000, [
      [700, 20],
      [20, 700],
      [300, 300],
    ]);
    const est = (await syncClock(c.fetchServerNow, { now: c.local, n: 3 }))!;
    expect(est.rttMs).toBe(600);
    // True offset is +90 s; the estimate may be off by at most rtt/2.
    expect(Math.abs(est.offsetMs - 90_000)).toBeLessThanOrEqual(est.rttMs / 2);
  });
});
