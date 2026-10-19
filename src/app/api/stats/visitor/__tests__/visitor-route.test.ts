// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/stats/visitor: what it refuses, what it does not count, and that
 * what reaches the store is a country and a region, never the address.
 */

const store = vi.hoisted(() => ({
  recordVisit: vi.fn(),
  visitorExists: vi.fn(),
}));
vi.mock("@/services/stats/store", async () => {
  const real = await vi.importActual<typeof import("@/services/stats/db/visitors")>("@/services/stats/db/visitors");
  const funnel = await vi.importActual<typeof import("@/services/stats/db/funnel")>("@/services/stats/db/funnel");
  return { isVisitorId: real.isVisitorId, isCohortDay: real.isCohortDay, isFunnelDevice: funnel.isFunnelDevice, ...store };
});
vi.mock("@/lib/geo/geoip", () => ({ lookup: (ip: string) => (ip === "203.0.113.50" ? { country: "US", region: "Nevada", city: null } : { country: null, region: null, city: null }) }));

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
let ipN = 0;

function req(body: unknown, { ua = UA, ip = "203.0.113.50" } = {}): NextRequest {
  return new NextRequest("http://localhost/api/stats/visitor", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.recordVisit.mockReset().mockResolvedValue({ created: true, claimed: false });
  store.visitorExists.mockReset().mockResolvedValue(false);
});

describe("POST /api/stats/visitor", () => {
  it("stores the visit with the resolved place and never the address", async () => {
    const { POST } = await import("../route");
    const res = await POST(req({ visitorId: "0123456789abcdef0123", device: "phone", look: "night", cohort: "2026-09-27", cohortDevice: "phone", cohortLook: "win98" }));
    expect(await res.json()).toEqual({ ok: true, counted: true });
    const arg = store.recordVisit.mock.calls[0][0];
    expect(arg).toEqual({
      id: "0123456789abcdef0123", device: "phone", look: "night",
      geo: { country: "US", region: "Nevada", city: null },
      cohort: "2026-09-27", cohortDevice: "phone", cohortLook: "win98", hereBefore: false,
    });
    expect(JSON.stringify(arg)).not.toContain("203.0.113.50");
  });

  it("refuses a malformed id or device", async () => {
    const { POST } = await import("../route");
    expect((await POST(req({ visitorId: "short", device: "phone" }, { ip: `198.51.100.${++ipN}` }))).status).toBe(400);
    expect((await POST(req({ visitorId: "funnel-0123456789abcdef", device: "phone" }, { ip: `198.51.100.${++ipN}` }))).status).toBe(400);
    expect((await POST(req({ visitorId: "0123456789abcdef", device: "tv" }, { ip: `198.51.100.${++ipN}` }))).status).toBe(400);
    expect(store.recordVisit).not.toHaveBeenCalled();
  });

  it("a robot is accepted and not counted", async () => {
    const { POST } = await import("../route");
    const res = await POST(req({ visitorId: "0123456789abcdef", device: "desktop" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1)", ip: `198.51.100.${++ipN}` }));
    expect(await res.json()).toEqual({ ok: true, counted: false });
    expect(store.recordVisit).not.toHaveBeenCalled();
  });

  it("a bad cohort is dropped, not refused, and takes its device and look with it", async () => {
    const { POST } = await import("../route");
    await POST(req({ visitorId: "0123456789abcdef", device: "desktop", cohort: "yesterday", cohortDevice: "phone", cohortLook: "night" }, { ip: `198.51.100.${++ipN}` }));
    expect(store.recordVisit.mock.calls[0][0]).toMatchObject({ cohort: null, cohortDevice: null, cohortLook: null });
  });

  it("one client minting ids past the cap is accepted and not counted; a known id still is", async () => {
    const { POST } = await import("../route");
    const ip = "192.0.2.77";
    vi.useFakeTimers();
    try {
      const counted: boolean[] = [];
      for (let i = 0; i < 40; i++) {
        // Under the per-minute limit: the cap being tested is the hourly one on new ids.
        if (i % 10 === 0) vi.advanceTimersByTime(61_000);
        const res = await POST(req({ visitorId: `id${String(i).padStart(14, "0")}`, device: "phone" }, { ip }));
        expect(res.status).toBe(200);
        counted.push((await res.json()).counted);
      }
      expect(counted.filter(Boolean)).toHaveLength(30);
      expect(counted.slice(30).every((c) => c === false)).toBe(true);
      expect(store.recordVisit).toHaveBeenCalledTimes(30);
      // Control: a browser already counted is still renewed from the same client.
      store.visitorExists.mockResolvedValue(true);
      vi.advanceTimersByTime(61_000);
      const known = await POST(req({ visitorId: "id00000000000000", device: "phone" }, { ip }));
      expect((await known.json()).counted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
