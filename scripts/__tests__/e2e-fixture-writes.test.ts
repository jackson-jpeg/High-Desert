import { describe, it, expect } from "vitest";
import { SERVER_WRITES } from "../../e2e/fixtures";

/**
 * What the e2e fixture answers in the page instead of letting it reach the
 * server. A write left off this list is a real write whenever the harness is
 * pointed at production.
 */
describe("e2e fixture: writes answered in the page", () => {
  it.each([
    "/api/stats/play",
    "/api/stats/stop",
    "/api/stats/rate",
    "/api/stats/heartbeat",
    "/api/stats/funnel",
    "/api/playback-event",
    "/live-api/tuned",
  ])("%s", (path) => {
    expect(SERVER_WRITES.test(`https://highdesert.space${path}`)).toBe(true);
  });

  it("reads and the calls themselves still reach the server", () => {
    for (const path of ["/api/stats/now", "/api/live/schedule", "/live-api/messages", "/live-api/stream", "/api/stats/playing"]) {
      expect(SERVER_WRITES.test(`https://highdesert.space${path}`)).toBe(false);
    }
  });
});
