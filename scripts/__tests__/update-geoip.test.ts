// @vitest-environment node
import { describe, it, expect } from "vitest";
import { failedStatus } from "../update-geoip.mjs";

/**
 * After a failed refresh the old file is still serving; status.json must still
 * say when it was built, or highdesert-status's geoip line cannot judge its age.
 */
describe("failedStatus", () => {
  const good = {
    ok: true,
    at: "2026-10-20T18:52:54.210Z",
    source: "https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz",
    size: 126998165,
    type: "DBIP-City-Lite",
    builtAt: "2026-10-01T01:41:21.000Z",
  };

  it("keeps the installed file's type and build date after a good refresh", () => {
    const s = failedStatus(good, new Error("HTTP 503"), "2026-11-04T04:50:00.000Z");
    expect(s).toEqual({
      ok: false,
      at: "2026-11-04T04:50:00.000Z",
      error: "HTTP 503",
      installed: { type: "DBIP-City-Lite", builtAt: "2026-10-01T01:41:21.000Z", source: good.source, size: 126998165, at: good.at },
    });
  });

  it("keeps carrying it through a second failure in a row", () => {
    const once = failedStatus(good, new Error("HTTP 503"), "2026-11-04T04:50:00.000Z");
    const twice = failedStatus(once, "timeout", "2026-12-04T04:50:00.000Z");
    expect(twice.installed.builtAt).toBe("2026-10-01T01:41:21.000Z");
    expect(twice.error).toBe("timeout");
  });

  it("has nothing to carry when there was never a good refresh", () => {
    expect(failedStatus(null, new Error("x")).installed).toBeNull();
  });
});
