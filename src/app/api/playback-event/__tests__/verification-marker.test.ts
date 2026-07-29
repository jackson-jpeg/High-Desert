import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A verification row must not be able to reach the real dataset.
 *
 * `playback_failures` is the instrument used to decide whether the five-second
 * duration floor is safe to promote to authoritative. Twice, checking that the
 * reporting pipeline works has written rows into it that had to be found,
 * dumped and deleted afterwards — once carrying a duration (`3.187`) that was
 * never observed, in the very table that exists to observe durations.
 *
 * "Intercept the POST in the page" was written into CLAUDE.md as the rule. This
 * is the same rule expressed as code, because a rule in a document is followed
 * by whoever read the document.
 *
 * The route is called directly rather than over HTTP: the point is the guard,
 * and the guard sits before anything that needs a database.
 */

const recordPlaybackFailure = vi.fn(() => Promise.resolve());

vi.mock("@/services/stats/store", () => ({
  recordPlaybackFailure: (...a: unknown[]) => recordPlaybackFailure(...(a as [])),
}));

vi.mock("@/services/stats/allowlist", () => ({
  isKnownEpisodeId: () => true,
}));

const { POST } = await import("../route");

let ipSeq = 0;

function post(body: Record<string, unknown>): Promise<Response> {
  // A fresh ip per call — the rate limiter is a shared in-memory Map and 20
  // requests/minute would otherwise make this suite order-dependent.
  ipSeq += 1;
  return POST(
    new NextRequest("https://highdesert.space/api/playback-event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${ipSeq % 250}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const VALID = {
  episodeId: "ultimate-ultimate-art-bell-collection--1997-06-18_-_Coast",
  kind: "network-error",
  retried: false,
  recovered: false,
  elapsedMs: 1200,
  uaClass: "desktop-chromium",
};

describe("the verification marker is refused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a payload whose detail carries the marker", async () => {
    const res = await post({ ...VALID, detail: "duration=3.187 (HD-VERIFY 50dd320)" });

    expect(res.status).toBe(400);
    // And, the part that matters: nothing reached the table.
    expect(recordPlaybackFailure).not.toHaveBeenCalled();
  });

  it("says why, rather than dropping it silently", async () => {
    // A guard that quietly does nothing is how the last three defects here
    // stayed hidden. Whoever tripped this needs to learn what to do instead.
    const res = await post({ ...VALID, detail: "HD-VERIFY" });
    const body = await res.json();

    expect(body.error).toMatch(/verification/i);
    expect(body.error).toMatch(/intercept the POST in the page/i);
  });

  it("matches the marker regardless of case", async () => {
    const res = await post({ ...VALID, detail: "probe hd-verify run 4" });

    expect(res.status).toBe(400);
    expect(recordPlaybackFailure).not.toHaveBeenCalled();
  });

  it("cannot be smuggled past the 200-character truncation", async () => {
    // The check runs *after* the slice, so padding the marker out beyond the
    // cut does not hide it — it would simply be cut off along with the padding.
    // What must not happen is the marker surviving into the row.
    const res = await post({ ...VALID, detail: `HD-VERIFY${"x".repeat(400)}` });

    expect(res.status).toBe(400);
    expect(recordPlaybackFailure).not.toHaveBeenCalled();
  });

  it("still accepts a real browser diagnostic", async () => {
    // The guard must not cost us the thing the column exists for.
    const res = await post({
      ...VALID,
      detail: "code=4 MEDIA_ELEMENT_ERROR: Format error",
    });

    expect(res.status).toBe(200);
    expect(recordPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(recordPlaybackFailure).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "code=4 MEDIA_ELEMENT_ERROR: Format error" }),
    );
  });

  it("still accepts a report with no detail at all", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    expect(recordPlaybackFailure).toHaveBeenCalledWith(
      expect.objectContaining({ detail: null }),
    );
  });
});
