// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** GET /api/stats/usage: the window it asks for, and no caching. */

const store = vi.hoisted(() => ({
  getUsage: vi.fn(async (days: number) => ({ days, routes: [], arrivals: [], playsBySurface: {} })),
}));
vi.mock("@/services/stats/store", () => ({ getUsage: store.getUsage }));

const { GET } = await import("../route");

let n = 0;
function read(query: string) {
  n += 1;
  return GET(new NextRequest(`http://localhost/api/stats/usage${query}`, { headers: { "x-forwarded-for": `10.22.0.${n % 250}` } }));
}

beforeEach(() => store.getUsage.mockClear());

describe("GET /api/stats/usage", () => {
  it.each([
    ["", 7],
    ["?days=7", 7],
    ["?days=30", 30],
    ["?days=90", 90],
    ["?days=365", 7],
    ["?days=abc", 7],
  ])("%s reads %d days", async (query, days) => {
    const res = await read(query);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(store.getUsage).toHaveBeenCalledWith(days);
    expect((await res.json()).days).toBe(days);
  });

  it("answers 503 when the store is down", async () => {
    store.getUsage.mockRejectedValueOnce(new Error("down"));
    expect((await read("?days=30")).status).toBe(503);
  });
});
