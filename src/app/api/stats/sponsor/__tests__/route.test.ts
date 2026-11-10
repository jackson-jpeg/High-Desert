// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** POST /api/stats/sponsor: only the vocabulary is counted (docs/station-breaks.md). */

const recordSponsorEvent = vi.fn(async () => {});
vi.mock("@/services/stats/db/sponsors", async (orig) => ({
  ...(await orig<typeof import("@/services/stats/db/sponsors")>()),
  recordSponsorEvent,
}));
const { POST } = await import("../route");

let ip = 0;
function post(body: unknown) {
  ip += 1;
  return POST(
    new NextRequest("http://localhost/api/stats/sponsor", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${ip}` },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => recordSponsorEvent.mockClear());

describe("POST /api/stats/sponsor", () => {
  it("counts a card seen, a click and a mute; with the spots off the air, never a spot heard", async () => {
    for (const b of [
      { app: "sogojet", surface: "air", event: "heard" },
      { app: "screenreceipts", surface: "chat", event: "seen" },
      { app: "simsunday", surface: "stats", event: "click" },
      { app: "sogojet", surface: "chat", event: "mute" },
    ]) {
      const r = await post(b);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    }
    // Spots are off the air (AIR_SPOTS false): "heard" from an old tab is accepted, never counted.
    expect(recordSponsorEvent.mock.calls).toEqual([
      ["screenreceipts", "chat", "seen"],
      ["simsunday", "stats", "click"],
      ["sogojet", "chat", "mute"],
    ]);
  });

  it("refuses an unknown app, surface or event, and an event its surface cannot have", async () => {
    for (const b of [
      { app: "acme", surface: "air", event: "heard" },
      { app: "sogojet", surface: "email", event: "seen" },
      { app: "sogojet", surface: "chat", event: "liked" },
      { app: "sogojet", surface: "air", event: "click" },
      { app: "sogojet", surface: "stats", event: "mute" },
    ]) {
      expect((await post(b)).status).toBe(400);
    }
    expect(recordSponsorEvent).not.toHaveBeenCalled();
  });
});
