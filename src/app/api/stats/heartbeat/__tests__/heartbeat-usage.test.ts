// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Time per tab on the heartbeat (docs/usage-tracking.md): a minute only from a
 * tab on screen with a known tab and device; anything else is ignored, never a
 * refusal, and presence is written exactly as before whatever the new fields
 * say. The presence half is heartbeat-live.test.ts and presence-*.db.test.ts.
 */

const store = vi.hoisted(() => ({
  SESSIONS_PER_CLIENT: 10,
  recordHeartbeat: vi.fn(async () => {}),
  recordRouteMinute: vi.fn(async () => {}),
}));
vi.mock("@/services/stats/store", () => store);
vi.mock("@/services/stats/allowlist", () => ({ isKnownEpisodeId: () => false }));

const { POST } = await import("@/app/api/stats/heartbeat/route");

let n = 0;
function beat(body: unknown, ip = `10.23.${Math.floor(++n / 250)}.${n % 250}`) {
  return POST(
    new NextRequest("http://localhost/api/stats/heartbeat", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

const S = "session-abcdefgh";

beforeEach(() => {
  store.recordHeartbeat.mockClear();
  store.recordRouteMinute.mockClear();
  store.recordRouteMinute.mockImplementation(async () => {});
});

describe("POST /api/stats/heartbeat: time per tab", () => {
  it("a visible beat adds a minute to its tab and device", async () => {
    const res = await beat({ sessionId: S, route: "live", device: "phone", visible: true });
    expect(res.status).toBe(200);
    expect(store.recordRouteMinute).toHaveBeenCalledWith("live", "phone");
    expect(store.recordHeartbeat).toHaveBeenCalledWith(S, null, expect.any(String), false, expect.anything());
  });

  it("a hidden tab, a missing field or an unknown value adds nothing, and the beat still succeeds", async () => {
    for (const extra of [
      { route: "live", device: "phone", visible: false },
      { route: "live", device: "phone", visible: "true" },
      { route: "live", device: "phone" },
      { route: "/live", device: "phone", visible: true },
      { route: "live", device: "tablet", visible: true },
      { device: "phone", visible: true },
    ]) {
      const res = await beat({ sessionId: S, ...extra });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(store.recordRouteMinute).not.toHaveBeenCalled();
    expect(store.recordHeartbeat).toHaveBeenCalledTimes(6);
  });

  it("a minute that cannot be stored does not fail the beat", async () => {
    store.recordRouteMinute.mockRejectedValueOnce(new Error("down"));
    const res = await beat({ sessionId: S, route: "library", device: "desktop", visible: true });
    expect(res.status).toBe(200);
    expect(store.recordHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("one client counts at most SESSIONS_PER_CLIENT minutes a minute", async () => {
    for (let i = 0; i < 15; i++) {
      const res = await beat({ sessionId: S, route: "radio", device: "desktop", visible: true }, "10.99.0.1");
      expect(res.status).toBe(200);
    }
    expect(store.recordRouteMinute).toHaveBeenCalledTimes(10);
    expect(store.recordHeartbeat).toHaveBeenCalledTimes(15);
  });
});
