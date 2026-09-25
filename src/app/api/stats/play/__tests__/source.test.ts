import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `source` on a play and on a failure: where the audio came from
 * (src/audio/sources.ts). It is how the archive.org outage fallback is seen
 * working — highdesert-status's "mirror plays in 24h" is a count of it — so
 * what reaches the store has to be exactly what the client said, or null.
 * Called directly: the point is the validation, which sits before the store.
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
  // A fresh address per call: the rate limiter is a shared in-memory Map.
  ipSeq += 1;
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ipSeq % 250}` },
    body: JSON.stringify(body),
  });
}

const EP = "ultimate-ultimate-art-bell-collection--1997-06-18_-_Coast";
const PLAY = { episodeId: EP, sessionId: "abcdefgh1234" };
const FAILURE = { episodeId: EP, kind: "network-error", retried: false, recovered: true, elapsedMs: 900, uaClass: "desktop-chromium" };

beforeEach(() => vi.clearAllMocks());

describe("/api/stats/play source", () => {
  it("passes a known source through to the store", async () => {
    const res = await play(req("https://highdesert.space/api/stats/play", { ...PLAY, source: "mirror" }));
    expect(res.status).toBe(200);
    expect(recordPlay.mock.calls[0][3]).toBe("mirror");
  });

  it("records an absent source as null — unknown, not archive.org", async () => {
    const res = await play(req("https://highdesert.space/api/stats/play", PLAY));
    expect(res.status).toBe(200);
    expect(recordPlay.mock.calls[0][3]).toBeNull();
  });

  it("refuses a source it does not know, and records nothing", async () => {
    const res = await play(req("https://highdesert.space/api/stats/play", { ...PLAY, source: "evil.example" }));
    expect(res.status).toBe(400);
    expect(recordPlay).not.toHaveBeenCalled();
  });
});

describe("/api/playback-event source", () => {
  it("passes a known source through", async () => {
    const res = await failure(req("https://highdesert.space/api/playback-event", { ...FAILURE, source: "archive" }));
    expect(res.status).toBe(200);
    expect(recordPlaybackFailure.mock.calls[0][0]).toMatchObject({ source: "archive" });
  });

  it("drops an unknown source to null rather than losing the failure", async () => {
    const res = await failure(req("https://highdesert.space/api/playback-event", { ...FAILURE, source: "x".repeat(500) }));
    expect(res.status).toBe(200);
    expect(recordPlaybackFailure.mock.calls[0][0]).toMatchObject({ source: null });
  });
});
