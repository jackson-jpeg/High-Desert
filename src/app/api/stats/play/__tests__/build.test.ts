import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `build` on a play and on a failure: the build that wrote the row
 * (src/lib/utils/build-id.ts). The release line counts a row against the build
 * that wrote it, so what reaches the store is exactly a build id, or null.
 * Never a refusal: a play or a failure is worth more than its tag.
 */

const recordPlay = vi.fn<(...a: unknown[]) => Promise<void>>(() => Promise.resolve());
const recordPlaybackFailure = vi.fn<(...a: unknown[]) => Promise<void>>(() => Promise.resolve());

vi.mock("@/services/stats/store", async () => {
  const actual = await vi.importActual<typeof import("@/services/stats/store")>("@/services/stats/store");
  return {
    isPlaySource: actual.isPlaySource,
    recordPlay: (...a: unknown[]) => recordPlay(...a),
    recordPlaybackFailure: (...a: unknown[]) => recordPlaybackFailure(...a),
  };
});
vi.mock("@/services/stats/allowlist", () => ({ isKnownEpisodeId: () => true }));

const play = (await import("../route")).POST;
const failure = (await import("@/app/api/playback-event/route")).POST;

let ipSeq = 0;
function req(url: string, body: Record<string, unknown>): NextRequest {
  ipSeq += 1;
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${ipSeq % 250}` },
    body: JSON.stringify(body),
  });
}

const EP = "ultimate-ultimate-art-bell-collection--1997-06-18_-_Coast";
const PLAY = { episodeId: EP, sessionId: "abcdefgh1234" };
const FAILURE = { episodeId: EP, kind: "stall", retried: true, recovered: false, elapsedMs: 900, uaClass: "ios-safari" };

beforeEach(() => vi.clearAllMocks());

describe("/api/stats/play build", () => {
  it("passes a build id through to the store", async () => {
    const res = await play(req("https://highdesert.space/api/stats/play", { ...PLAY, build: "1ff3416" }));
    expect(res.status).toBe(200);
    expect(recordPlay.mock.calls[0][4]).toBe("1ff3416");
  });

  it("stores an absent or malformed build as null, and still counts the play", async () => {
    for (const build of [undefined, "dev", "1ff3416; DROP", 42]) {
      vi.clearAllMocks();
      const res = await play(req("https://highdesert.space/api/stats/play", { ...PLAY, build }));
      expect(res.status).toBe(200);
      expect(recordPlay.mock.calls[0][4]).toBeNull();
    }
  });
});

describe("/api/playback-event build", () => {
  it("passes a build id through", async () => {
    const res = await failure(req("https://highdesert.space/api/playback-event", { ...FAILURE, build: "1ff3416-0a1b2c3" }));
    expect(res.status).toBe(200);
    expect(recordPlaybackFailure.mock.calls[0][0]).toMatchObject({ build: "1ff3416-0a1b2c3" });
  });

  it("drops a malformed build to null rather than losing the failure", async () => {
    const res = await failure(req("https://highdesert.space/api/playback-event", { ...FAILURE, build: "x".repeat(300) }));
    expect(res.status).toBe(200);
    expect(recordPlaybackFailure.mock.calls[0][0]).toMatchObject({ build: null });
  });
});
