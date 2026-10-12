// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `look` on a play: the look the sending page was rendered in (docs/looks.md).
 * A known one reaches the store; anything else is stored as unknown (null),
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

describe("/api/stats/play look", () => {
  it.each(["win98", "night"])("passes %s through to the store", async (look) => {
    const res = await play({ ...PLAY, look });
    expect(res.status).toBe(200);
    expect(recordPlay.mock.calls[0][6]).toBe(look);
  });

  it("stores an absent or unknown look as null and still counts the play", async () => {
    for (const look of [undefined, "", "Night", "clean", "default", 7]) {
      const res = await play({ ...PLAY, look });
      expect(res.status).toBe(200);
    }
    expect(recordPlay).toHaveBeenCalledTimes(6);
    expect(recordPlay.mock.calls.map((c) => c[6])).toEqual([null, null, null, null, null, null]);
  });
});
