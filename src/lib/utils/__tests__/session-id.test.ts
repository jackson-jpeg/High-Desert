import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * SESSION_ID is one anonymous id per page load. Two things have to hold:
 *
 * - It passes the API's format check (8–64 of [A-Za-z0-9_-], the regex in
 *   /api/stats/play and /api/stats/heartbeat). An id that fails it makes every
 *   play and heartbeat from this tab a 400: the listener is not counted and
 *   nothing tells them.
 * - It is different on every load. Presence counts distinct session ids, so
 *   two tabs sharing one are one listener; and an id that repeated across
 *   visits would be exactly the returning-visitor identifier this is designed
 *   not to be (src/lib/utils/session-id.ts).
 *
 * Each case loads a fresh copy of the module, the way a page load does.
 */

const API_FORMAT = /^[a-zA-Z0-9_-]{8,64}$/;

async function load(): Promise<string> {
  vi.resetModules();
  return (await import("../session-id")).SESSION_ID;
}

afterEach(() => vi.unstubAllGlobals());

describe("SESSION_ID", () => {
  it("satisfies the API's session id format", async () => {
    expect(await load()).toMatch(API_FORMAT);
  });

  it("is new on every page load", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(await load());
    expect(ids.size).toBe(5);
  });

  it("falls back to a valid, still-random id where crypto.randomUUID is missing", async () => {
    vi.stubGlobal("crypto", {});
    const a = await load();
    const b = await load();
    expect(a).toMatch(API_FORMAT);
    expect(b).toMatch(API_FORMAT);
    expect(a).not.toBe(b);
  });
});
