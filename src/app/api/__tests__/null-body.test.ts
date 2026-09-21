// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Every POST stats route, sent bodies that are valid JSON but not an object.
 *
 * `request.json()` returns `null` for a body of `null`, and each route then
 * destructured it — a TypeError, surfacing as an unhandled 500. They must be
 * 400s, and they must be rejected before anything touches the store.
 *
 * The real routes are imported; only the store is replaced, and it throws if
 * called, so a route that got past validation fails loudly rather than
 * silently returning something plausible.
 */

const touched = vi.fn();
vi.mock("@/services/stats/store", () =>
  new Proxy(
    {},
    {
      get: (_t, name) =>
        name === "then"
          ? undefined
          : (...args: unknown[]) => {
              touched(name, args);
              throw new Error(`store.${String(name)} must not be reached`);
            },
    },
  ),
);
vi.mock("@/services/stats/allowlist", () => ({ isKnownEpisodeId: () => true }));

const ROUTES = {
  play: () => import("../stats/play/route"),
  heartbeat: () => import("../stats/heartbeat/route"),
  stop: () => import("../stats/stop/route"),
  rate: () => import("../stats/rate/route"),
  "playback-event": () => import("../playback-event/route"),
} as const;

let ip = 0;
function post(body: string): NextRequest {
  // A fresh address per request, so the rate limiter never answers first.
  ip += 1;
  return new NextRequest("http://localhost/api/x", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip % 250}` },
  });
}

describe.each(Object.entries(ROUTES))("POST /api/%s", (_name, load) => {
  it.each(["null", "42", '"a string"', "[]", "true"])("returns 400 for a JSON body of %s", async (body) => {
    const { POST } = await load();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(touched).not.toHaveBeenCalled();
  });

  it("still returns 400 for a body that is not JSON at all", async () => {
    const { POST } = await load();
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
  });
});
