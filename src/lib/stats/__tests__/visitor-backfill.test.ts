import { describe, it, expect } from "vitest";
import { planPlaceholders } from "../visitor-backfill";

/**
 * The backfill's arithmetic: how many placeholders each funnel arrival day
 * keeps once browsers have claimed theirs. The invariant every case checks is
 * the one the visitor count depends on: per (day, device), placeholders +
 * claimed browsers = the funnel's arrivals, never more, never fewer (unless
 * more browsers claimed a day than the funnel counted, when it is zero).
 */

const total = (p: { looks: Record<string, number> }) => Object.values(p.looks).reduce((a, b) => a + b, 0);

describe("planPlaceholders", () => {
  it("with no claims, one placeholder per arrival, in the look it arrived in", () => {
    const plan = planPlaceholders(
      [
        { day: "2026-09-27", device: "phone", look: null, n: 215 },
        { day: "2026-10-13", device: "phone", look: "win98", n: 7 },
        { day: "2026-10-13", device: "phone", look: "night", n: 3 },
      ],
      [],
      [],
    );
    expect(plan).toEqual([
      { day: "2026-09-27", device: "phone", looks: { win98: 0, night: 0, none: 215 }, returners: 0 },
      { day: "2026-10-13", device: "phone", looks: { win98: 7, night: 3, none: 0 }, returners: 0 },
    ]);
  });

  it("a claimed browser removes exactly one placeholder from its day and device", () => {
    const plan = planPlaceholders(
      [
        { day: "2026-10-13", device: "phone", look: "win98", n: 7 },
        { day: "2026-10-13", device: "desktop", look: "win98", n: 4 },
      ],
      [],
      [{ day: "2026-10-13", device: "phone", look: "win98", n: 2 }],
    );
    expect(plan.find((p) => p.device === "phone")?.looks).toEqual({ win98: 5, night: 0, none: 0 });
    // Control: the other device is untouched.
    expect(plan.find((p) => p.device === "desktop")?.looks).toEqual({ win98: 4, night: 0, none: 0 });
  });

  it("a claim in a look the funnel lacked still takes one, from the unknown look, keeping the total exact", () => {
    const plan = planPlaceholders(
      [
        { day: "2026-10-01", device: "phone", look: null, n: 5 },
        { day: "2026-10-01", device: "phone", look: "win98", n: 2 },
      ],
      [],
      [{ day: "2026-10-01", device: "phone", look: "night", n: 3 }],
    );
    expect(total(plan[0])).toBe(4);
    expect(plan[0].looks).toEqual({ win98: 2, night: 0, none: 2 });
  });

  it("more claims than arrivals leaves none, never a negative", () => {
    const plan = planPlaceholders(
      [{ day: "2026-10-01", device: "desktop", look: null, n: 2 }],
      [],
      [{ day: "2026-10-01", device: "desktop", look: null, n: 5 }],
    );
    expect(plan[0].looks).toEqual({ win98: 0, night: 0, none: 0 });
    expect(plan[0].returners).toBe(0);
  });

  it("returns are scaled to the placeholders left, and never exceed them", () => {
    const [p] = planPlaceholders(
      [{ day: "2026-09-27", device: "phone", look: null, n: 200 }],
      [{ day: "2026-09-27", device: "phone", n: 20 }],
      [{ day: "2026-09-27", device: "phone", look: null, n: 100 }],
    );
    expect(total(p)).toBe(100);
    expect(p.returners).toBe(10);
    const [all] = planPlaceholders(
      [{ day: "2026-09-27", device: "phone", look: null, n: 3 }],
      [{ day: "2026-09-27", device: "phone", n: 9 }],
      [],
    );
    expect(all.returners).toBe(3);
  });

  it("holds the invariant on the production funnel as of 2026-10-19, with arbitrary claims", () => {
    // /api/stats/funnel?days=90 on 2026-10-19: visits per (day, device), the first days.
    const prod: [string, "phone" | "desktop", number][] = [
      ["2026-09-27", "phone", 215], ["2026-09-27", "desktop", 71], ["2026-09-28", "phone", 141],
      ["2026-09-28", "desktop", 69], ["2026-09-29", "phone", 55], ["2026-09-29", "desktop", 33],
    ];
    const arrivals = prod.map(([day, device, n]) => ({ day, device, look: null, n }));
    const claimed = prod.map(([day, device, n], i) => ({ day, device, look: (i % 2 ? "night" : null) as "night" | null, n: Math.floor(n / (i + 2)) }));
    const plan = planPlaceholders(arrivals, [], claimed);
    for (const [day, device, n] of prod) {
      const p = plan.find((x) => x.day === day && x.device === device)!;
      const c = claimed.find((x) => x.day === day && x.device === device)!.n;
      expect(total(p) + c).toBe(n);
    }
  });

  it("days with arrivals of zero are not planned", () => {
    expect(planPlaceholders([{ day: "2026-10-01", device: "phone", look: null, n: 0 }], [], [])).toEqual([]);
  });
});
