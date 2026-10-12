// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/stats/view: what reaches the store is a known tab, a known device
 * and, at most, a well-formed arrival. The store half is usage.db.test.ts.
 */

const store = vi.hoisted(() => ({ recordView: vi.fn(async () => {}) }));
vi.mock("@/services/stats/store", () => ({ recordView: store.recordView }));

const { POST } = await import("../route");

let n = 0;
function view(body: unknown) {
  n += 1;
  return POST(
    new NextRequest("http://localhost/api/stats/view", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.21.0.${n % 250}` },
    }),
  );
}

beforeEach(() => store.recordView.mockClear());

describe("POST /api/stats/view", () => {
  it("counts a known tab and device", async () => {
    const res = await view({ route: "library", device: "phone" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.recordView).toHaveBeenCalledWith("library", "phone", null);
  });

  it("passes a well-formed arrival through", async () => {
    await view({ route: "live", device: "desktop", arrival: { source: "ai", landing: "live" } });
    expect(store.recordView).toHaveBeenCalledWith("live", "desktop", { source: "ai", landing: "live", look: null });
  });

  it("carries the arrival's look; an unknown look is stored unknown and the arrival still counts", async () => {
    await view({ route: "live", device: "phone", arrival: { source: "reddit", landing: "live", look: "night" } });
    await view({ route: "live", device: "phone", arrival: { source: "reddit", landing: "live", look: "win98" } });
    await view({ route: "live", device: "phone", arrival: { source: "reddit", landing: "live", look: "clean" } });
    expect(store.recordView.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      { source: "reddit", landing: "live", look: "night" },
      { source: "reddit", landing: "live", look: "win98" },
      { source: "reddit", landing: "live", look: null },
    ]);
  });

  it("drops an arrival that is not well formed and still counts the view", async () => {
    for (const arrival of [
      { source: "https://www.reddit.com/r/x", landing: "live" },
      { source: "reddit", landing: "/live" },
      "reddit",
      null,
      { source: "reddit" },
    ]) {
      const res = await view({ route: "radio", device: "desktop", arrival });
      expect(res.status).toBe(200);
    }
    expect(store.recordView.mock.calls.map((c) => (c as unknown[])[2])).toEqual([null, null, null, null, null]);
  });

  it("refuses an unknown tab or device before the store", async () => {
    expect((await view({ route: "/library", device: "desktop" })).status).toBe(400);
    expect((await view({ route: "scanner", device: "desktop" })).status).toBe(400);
    expect((await view({ route: "library", device: "tablet" })).status).toBe(400);
    expect((await view({ device: "phone" })).status).toBe(400);
    expect(store.recordView).not.toHaveBeenCalled();
  });

  it("answers 503 when the store is down", async () => {
    store.recordView.mockRejectedValueOnce(new Error("down"));
    expect((await view({ route: "stats", device: "desktop" })).status).toBe(503);
  });
});
