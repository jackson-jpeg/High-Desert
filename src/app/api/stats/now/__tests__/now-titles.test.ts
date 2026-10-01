import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/stats/now carries each id's catalog title, so a browser whose library
 * lacks the show (seeded before a catalog import) can still name it
 * (2026-10-01, src/lib/library/display-title.ts).
 */

const KNOWN = "Art-Bell_Midnight_In_the_Desert--2015-12-08_-_Art_Bell_MITD_-_Dr_David_Jacobs_Alien_Experimentation_on_Humans";
const UNKNOWN = "coll--not_in_the_catalog";

vi.mock("@/services/stats/store", () => ({
  getNowPlaying: async () => ({
    online: 3,
    listening: 2,
    live: 1,
    onAir: [
      { episodeId: KNOWN, listeners: 1 },
      { episodeId: UNKNOWN, listeners: 1 },
    ],
    recent: [{ episodeId: KNOWN, at: "2026-10-01T00:00:00.000Z" }],
  }),
}));

const { GET } = await import("@/app/api/stats/now/route");

describe("GET /api/stats/now: titles", () => {
  it("every onAir and recent entry has the catalog title, or null", async () => {
    const res = await GET(new NextRequest("http://localhost/api/stats/now", { headers: { "x-forwarded-for": "10.8.0.1" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onAir).toEqual([
      { episodeId: KNOWN, listeners: 1, title: "Midnight in the Desert - Alien Experimentation on Humans" },
      { episodeId: UNKNOWN, listeners: 1, title: null },
    ]);
    expect(body.recent[0].title).toBe("Midnight in the Desert - Alien Experimentation on Humans");
    expect({ online: body.online, listening: body.listening, live: body.live }).toEqual({ online: 3, listening: 2, live: 1 });
  });
});
