// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The heartbeat's location (docs/visitors.md): the session gets the country
 * and region the address resolved to, never the address, and a beat that
 * tunes in adds one "tuning in from" line, once per client per half hour.
 */

const store = vi.hoisted(() => ({
  recordHeartbeat: vi.fn(),
  recordTuneIn: vi.fn(async () => {}),
  recordRouteMinute: vi.fn(async () => {}),
  SESSIONS_PER_CLIENT: 10,
}));
vi.mock("@/services/stats/store", () => store);
vi.mock("@/lib/geo/geoip", () => ({
  lookup: (ip: string) => (ip.startsWith("203.0.113.") ? { country: "US", region: "Nevada", city: null } : { country: null, region: null, city: null }),
}));

const beat = (ip: string, live = true) =>
  new NextRequest("http://localhost/api/stats/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ sessionId: "session-geo-0001", live }),
  });

beforeEach(() => {
  store.recordHeartbeat.mockReset().mockResolvedValue({ tunedIn: true });
  store.recordTuneIn.mockClear();
});

describe("POST /api/stats/heartbeat — location", () => {
  it("hands the store a place, not the address", async () => {
    const { POST } = await import("../route");
    await POST(beat("203.0.113.10"));
    const args = store.recordHeartbeat.mock.calls[0];
    expect(args[4]).toEqual({ country: "US", region: "Nevada", city: null });
    expect(JSON.stringify(args[4])).not.toContain("203.0.113");
  });

  it("a tune-in adds one line per client per half hour", async () => {
    const { POST } = await import("../route");
    await POST(beat("203.0.113.20"));
    await POST(beat("203.0.113.20"));
    await POST(beat("203.0.113.21"));
    expect(store.recordTuneIn).toHaveBeenCalledTimes(2);
    expect(store.recordTuneIn).toHaveBeenCalledWith({ country: "US", region: "Nevada", city: null });
  });

  it("no line when the beat did not tune in, or the place is unknown", async () => {
    const { POST } = await import("../route");
    store.recordHeartbeat.mockResolvedValue({ tunedIn: false });
    await POST(beat("203.0.113.30"));
    store.recordHeartbeat.mockResolvedValue({ tunedIn: true });
    await POST(beat("198.51.100.30"));
    expect(store.recordTuneIn).not.toHaveBeenCalled();
  });
});
