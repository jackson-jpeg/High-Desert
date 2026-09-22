// @vitest-environment node
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";
import { publicDetail, publicDetails, UNRECOGNISED_DETAIL } from "@/services/stats/failure-detail";
import COMMUNITY_KEYS from "@/data/community-keys.json";

/**
 * HD-038: `detail` is text anyone can POST to /api/playback-event, and
 * /api/stats/failures is public. Only browser-diagnostic shapes may come back
 * out; everything else is replaced, and real diagnostics still get through.
 */

const SPAM = "BUY CHEAP WATCHES at spam.example — call 555-0100";

describe("publicDetail", () => {
  it("keeps what the client actually writes", () => {
    expect(publicDetail("code=3")).toBe("code=3");
    expect(publicDetail("code=4 DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed")).toBe(
      "code=4 DEMUXER_ERROR_COULD_NOT_OPEN",
    );
    expect(publicDetail("code=3 PIPELINE_ERROR_DECODE: audio decode failed")).toBe("code=3 PIPELINE_ERROR_DECODE");
    expect(publicDetail("code=4 MEDIA_ELEMENT_ERROR: Format error")).toBe("code=4 MEDIA_ELEMENT_ERROR");
    expect(publicDetail("code=3 NS_ERROR_DOM_MEDIA_METADATA_ERR (0x806e0006)")).toBe(
      "code=3 NS_ERROR_DOM_MEDIA_METADATA_ERR",
    );
    expect(publicDetail("duration=2.113")).toBe("duration=2.113");
    expect(publicDetail("ended duration=0.000")).toBe("ended duration=0.000");
    expect(publicDetail("duration=NaN")).toBe("duration=NaN");
  });

  it("drops free text after a real code, and unknown status words", () => {
    expect(publicDetail(`code=3 ${SPAM}`)).toBe("code=3");
    expect(publicDetail("code=3 DEMUXER_ERROR_X: " + SPAM)).toBe("code=3 DEMUXER_ERROR_X");
    expect(publicDetail("code=3 VISIT_MY_SITE: now")).toBe("code=3");
  });

  it("refuses every other shape", () => {
    for (const s of [SPAM, "duration=2.1 " + SPAM, "code=999", "<script>alert(1)</script>", "code=3\nspam", ""]) {
      expect(publicDetail(s)).toBeNull();
    }
  });
});

describe("publicDetails", () => {
  it("junk cannot crowd real diagnostics out of the three slots", () => {
    const stored = ["spam 1", "spam 2", "spam 3", "spam 4", "code=4 DEMUXER_ERROR_COULD_NOT_OPEN: x", "code=2"];
    expect(publicDetails(stored)).toEqual(["code=4 DEMUXER_ERROR_COULD_NOT_OPEN", "code=2", UNRECOGNISED_DETAIL]);
  });

  it("collapses two tails on one status word into one diagnostic", () => {
    expect(publicDetails(["code=4 DEMUXER_ERROR_COULD_NOT_OPEN: a", "code=4 DEMUXER_ERROR_COULD_NOT_OPEN: b"])).toEqual([
      "code=4 DEMUXER_ERROR_COULD_NOT_OPEN",
    ]);
  });
});

/**
 * End to end: POST the real ingest route, GET the real public route, real
 * Postgres in between. The spam is stored intact (it is the admin's by psql)
 * and never served.
 */
type Store = typeof import("@/services/stats/store");
let store: Store;
let ingest: typeof import("../../../playback-event/route");
let failures: typeof import("../route");
// An episode no other test uses, so this one's details are the only details.
const EPISODE = (COMMUNITY_KEYS as string[])[11];

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("@/services/stats/store");
  ingest = await import("../../../playback-event/route");
  failures = await import("../route");
  await store.getPool().query("DELETE FROM playback_failures WHERE episode_id = $1", [EPISODE]);
});

afterAll(async () => {
  if (!store) return;
  await store.getPool().query("DELETE FROM playback_failures WHERE episode_id = $1", [EPISODE]);
  await store.getPool().end();
});

let ip = 0;
async function report(detail: string) {
  ip += 1;
  const res = await ingest.POST(
    new NextRequest("http://localhost/api/playback-event", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${ip}` },
      body: JSON.stringify({ episodeId: EPISODE, kind: "decode-error", elapsedMs: 10, uaClass: "desktop-chromium", detail }),
    }),
  );
  expect(res.status).toBe(200);
}

describeDb("/api/stats/failures serves only diagnostic details (Postgres)", () => {
  it("attacker text never appears in the output; real diagnostics do", async () => {
    await report("code=4 DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed");
    for (let i = 0; i < 4; i++) await report(`${SPAM} #${i}`);
    await report(`code=3 ${SPAM}`);

    const res = await failures.GET(
      new NextRequest("http://localhost/api/stats/failures?days=7", { headers: { "x-forwarded-for": "192.0.2.250" } }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("WATCHES");
    expect(text).not.toContain("spam.example");

    const entry = JSON.parse(text).entries.find((e: { episodeId: string }) => e.episodeId === EPISODE);
    expect(entry.details).toEqual(["code=3", "code=4 DEMUXER_ERROR_COULD_NOT_OPEN", UNRECOGNISED_DETAIL]);
    // Still counted as failures: filtering is of what is shown, not what happened.
    expect(entry.failures).toBe(6);

    // Stored intact for diagnosis by hand.
    const { rows } = await store
      .getPool()
      .query("SELECT count(*)::int AS n FROM playback_failures WHERE episode_id = $1 AND detail LIKE '%WATCHES%'", [EPISODE]);
    expect(rows[0].n).toBe(5);
  });
});
