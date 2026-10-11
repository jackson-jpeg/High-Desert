import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The station's breaker (src/services/live/breaker.ts) hears every failure
 * report: the route passes it the tab's own `live` mark, the client key and
 * the kind, whether or not the row can be written. Without this wiring the
 * breaker would be a check connected to nothing (docs/disconnected-checks.md).
 */

const note = vi.fn((..._a: unknown[]) => Promise.resolve(null));
vi.mock("@/services/live/breaker", () => ({ stationBreaker: () => ({ note }) }));
vi.mock("@/services/stats/store", async () => ({
  isPlaySource: (await vi.importActual<typeof import("@/services/stats/store")>("@/services/stats/store")).isPlaySource,
  recordPlaybackFailure: () => Promise.reject(new Error("no database")),
}));
vi.mock("@/services/stats/allowlist", () => ({ isKnownEpisodeId: () => true }));

const { POST } = await import("../route");

let seq = 0;
function post(body: Record<string, unknown>) {
  seq += 1;
  return POST(
    new NextRequest("https://highdesert.space/api/playback-event", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${seq}` },
      body: JSON.stringify(body),
    }),
  );
}
const BASE = { episodeId: "coll--ep", kind: "decode-error", retried: false, recovered: false, elapsedMs: 900, uaClass: "android-chrome" };

beforeEach(() => note.mockClear());

describe("/api/playback-event feeds the station's breaker", () => {
  it("passes the live mark, the client and the kind, even when the row cannot be written", async () => {
    await post({ ...BASE, live: true });
    expect(note).toHaveBeenCalledTimes(1);
    expect(note.mock.calls[0][0]).toMatchObject({ episodeId: "coll--ep", kind: "decode-error", recovered: false, live: true, client: `198.51.100.${seq}` });
  });

  it("only a literal true is live", async () => {
    await post({ ...BASE, live: "yes" });
    expect(note.mock.calls[0][0]).toMatchObject({ live: false });
  });
});
