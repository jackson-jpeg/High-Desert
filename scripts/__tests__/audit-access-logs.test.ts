// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

/**
 * The access-log audit: which lines are a person loading a page, the UTC day
 * of nginx's local time, and one client per address bucket per day (an IPv6
 * /64 is one client). Nothing it returns is an address.
 */

const al = await import("../audit-access-logs.mjs");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1";
const line = (ip: string, time: string, url: string, status = 200, ua = UA, method = "GET") =>
  `${ip} - - [${time}] "${method} ${url} HTTP/2.0" ${status} 1234 "-" "${ua}"`;

describe("audit-access-logs", () => {
  it("UTC day from nginx's local time", () => {
    expect(al.utcDay("19/Oct/2026:23:30:00 -0700")).toBe("2026-10-20");
    expect(al.utcDay("19/Oct/2026:00:10:00 +0200")).toBe("2026-10-18");
    expect(al.utcDay("nonsense")).toBeNull();
  });

  it("a page load by a person, and not an asset, an API call, a robot, a POST or a 404", () => {
    const t = "19/Oct/2026:12:00:00 +0000";
    expect(al.pageLoad(line("203.0.113.1", t, "/live"))).toMatchObject({ day: "2026-10-19" });
    expect(al.pageLoad(line("203.0.113.1", t, "/show/1992-12-12-area-51?t=30"))).not.toBeNull();
    for (const l of [
      line("203.0.113.1", t, "/_next/static/chunks/a.js"),
      line("203.0.113.1", t, "/api/stats/now"),
      line("203.0.113.1", t, "/mirror/abc"),
      line("203.0.113.1", t, "/icon.png"),
      line("203.0.113.1", t, "/live", 200, "Mozilla/5.0 (compatible; Googlebot/2.1)"),
      line("203.0.113.1", t, "/live", 200, ""),
      line("203.0.113.1", t, "/live", 200, UA, "POST"),
      line("203.0.113.1", t, "/nope", 404),
    ]) expect(al.pageLoad(l)).toBeNull();
  });

  it("distinct clients per day across plain and gzipped files; a /64 is one client", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "audit-logs-"));
    try {
      const d1 = "05/Oct/2026:10:00:00 +0000";
      const d2 = "06/Oct/2026:10:00:00 +0000";
      writeFileSync(path.join(dir, "a.log"), [
        line("203.0.113.1", d1, "/"), line("203.0.113.1", d1, "/library"),
        line("2001:db8:1:2::a", d1, "/live"), line("2001:db8:1:2::b", d1, "/live"),
        line("198.51.100.9", d1, "/api/stats/now"),
      ].join("\n"));
      writeFileSync(path.join(dir, "b.log.gz"), gzipSync([line("203.0.113.1", d2, "/"), line("198.51.100.9", d2, "/live")].join("\n")));
      const r = await al.audit([path.join(dir, "a.log"), path.join(dir, "b.log.gz")]);
      expect(r).toMatchObject({ pageLoads: 6, earliest: "2026-10-05", latest: "2026-10-06", distinctClients: 3 });
      expect(r.perDay).toEqual([{ day: "2026-10-05", clients: 2 }, { day: "2026-10-06", clients: 2 }]);
      expect(JSON.stringify(r)).not.toMatch(/203\.0\.113|2001:db8|198\.51/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
