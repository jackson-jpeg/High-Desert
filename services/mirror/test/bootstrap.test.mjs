// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dhtBootstrap } from "../lib/bootstrap.mjs";

/**
 * The DHT's bootstrap list, resolved to IPv4 before the library sees it. The
 * resolver is injected and answers the way this server's does: IPv6 first
 * unless asked for IPv4, and some hosts with no A record at all.
 */
const RECORDS = {
  "dual.example": { 4: "192.0.2.10", 6: "2001:db8::10" },
  "v6only.example": { 6: "2001:db8::20" },
  "v4only.example": { 4: "192.0.2.30" },
};

async function lookup(host, opts = {}) {
  const r = RECORDS[host];
  if (!r) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  if (opts.family === 4) {
    if (!r[4]) throw Object.assign(new Error(`ENODATA ${host}`), { code: "ENODATA" });
    return { address: r[4], family: 4 };
  }
  return r[6] ? { address: r[6], family: 6 } : { address: r[4], family: 4 };
}

describe("dhtBootstrap", () => {
  it("resolves every host to IPv4, never the IPv6 address a udp4 socket cannot reach", async () => {
    const got = await dhtBootstrap(
      [
        { host: "dual.example", port: 6881 },
        { host: "v4only.example", port: 25401 },
      ],
      lookup,
    );
    expect(got).toEqual(["192.0.2.10:6881", "192.0.2.30:25401"]);
  });

  it("skips hosts with no IPv4 address or no record, and keeps the rest", async () => {
    const got = await dhtBootstrap(
      [
        { host: "v6only.example", port: 6881 },
        { host: "gone.example", port: 6881 },
        { host: "dual.example", port: 6881 },
      ],
      lookup,
    );
    expect(got).toEqual(["192.0.2.10:6881"]);
  });
});
