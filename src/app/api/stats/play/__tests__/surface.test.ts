// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `surface` on a play: where it was started (src/audio/play-surface.ts). A
 * known one reaches the store; anything else is stored as unknown (null),
 * never a 400, so a play is never lost to its tag.
 */

const recordPlay = vi.fn<(...a: unknown[]) => Promise<void>>(() => Promise.resolve());

vi.mock("@/services/stats/store", async () => {
  const actual = await vi.importActual<typeof import("@/services/stats/store")>("@/services/stats/store");
  return { isPlaySource: actual.isPlaySource, recordPlay: (...a: unknown[]) => recordPlay(...a) };
});
vi.mock("@/services/stats/allowlist", () => ({ isKnownEpisodeId: () => true }));

const { POST } = await import("../route");

let n = 0;
function play(body: Record<string, unknown>) {
  n += 1;
  return POST(
    new NextRequest("https://highdesert.space/api/stats/play", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${n % 250}` },
      body: JSON.stringify(body),
    }),
  );
}

const PLAY = { episodeId: "coll--show", sessionId: "abcdefgh1234" };

beforeEach(() => recordPlay.mockClear());

describe("/api/stats/play surface", () => {
  it.each(["library", "radio", "live", "stats", "show", "palette", "queue", "restore", "other"])(
    "passes %s through to the store",
    async (surface) => {
      const res = await play({ ...PLAY, surface });
      expect(res.status).toBe(200);
      expect(recordPlay.mock.calls[0][5]).toBe(surface);
    },
  );

  it("stores an absent or unknown surface as null and still counts the play", async () => {
    for (const surface of [undefined, "", "Library", "https://evil.example", 7, { x: 1 }]) {
      const res = await play({ ...PLAY, surface });
      expect(res.status).toBe(200);
    }
    expect(recordPlay).toHaveBeenCalledTimes(6);
    expect(recordPlay.mock.calls.map((c) => c[5])).toEqual([null, null, null, null, null, null]);
  });
});
