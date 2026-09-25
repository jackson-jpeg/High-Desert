import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The heartbeat route passes the live flag through to the store — and only a
 * literal `true` counts. The store half (the `live_at` mark and the presence
 * count) is `presence-clients.db.test.ts`.
 */

const store = vi.hoisted(() => ({ recordHeartbeat: vi.fn(async () => {}) }));
vi.mock("@/services/stats/store", () => ({ recordHeartbeat: store.recordHeartbeat }));
vi.mock("@/services/stats/allowlist", () => ({ isKnownEpisodeId: (id: string) => id === "coll--show" }));

const { POST } = await import("@/app/api/stats/heartbeat/route");

let n = 0;
function beat(body: unknown) {
  // A fresh client per request, so the rate limit never enters into it.
  n += 1;
  return POST(
    new NextRequest("http://localhost/api/stats/heartbeat", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${n}` },
    }),
  );
}

beforeEach(() => store.recordHeartbeat.mockClear());

describe("POST /api/stats/heartbeat — live", () => {
  it("live: true reaches the store as true", async () => {
    const res = await beat({ sessionId: "session-abcdefgh", episodeId: "coll--show", live: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.recordHeartbeat).toHaveBeenCalledWith("session-abcdefgh", "coll--show", expect.any(String), true);
  });

  it("absent, false, or a truthy non-boolean is not live", async () => {
    for (const live of [undefined, false, "true", 1]) {
      await beat({ sessionId: "session-abcdefgh", live });
    }
    expect(store.recordHeartbeat.mock.calls.map((c) => (c as unknown[])[3])).toEqual([false, false, false, false]);
  });
});
