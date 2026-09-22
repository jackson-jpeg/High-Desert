// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { clientKey, hashClientKey, voterId, HASHED_VOTER_RE } from "../client-key";

/**
 * The bucket every per-client limit keys on (HD-007) and the input to the
 * rating voter hash (HD-008). Getting this wrong in the permissive direction
 * hands out unlimited identities; in the strict direction it merges strangers.
 */

describe("clientKey — IPv6 is bucketed on the /64", () => {
  it("two addresses in one /64 are one client", () => {
    expect(clientKey("2001:db8:1:2::1")).toBe(clientKey("2001:db8:1:2:ffff:ffff:ffff:fffe"));
    expect(clientKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
  });

  it("addresses in different /64s are different clients", () => {
    expect(clientKey("2001:db8:1:2::1")).not.toBe(clientKey("2001:db8:1:3::1"));
  });

  it("spelling does not matter: compressed, expanded, case, leading zeros", () => {
    const want = "2001:db8:0:a::/64";
    expect(clientKey("2001:0DB8:0000:000A:0000:0000:0000:0001")).toBe(want);
    expect(clientKey("2001:db8::a:0:0:0:1")).toBe(want);
    expect(clientKey("2001:db8:0:a::")).toBe(want);
  });

  it("accepts bracket, port and zone forms", () => {
    expect(clientKey("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
    expect(clientKey("[2001:db8:1:2::1]:443")).toBe("2001:db8:1:2::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
});

describe("clientKey — IPv4", () => {
  it("is per address", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("203.0.113.7")).not.toBe(clientKey("203.0.113.8"));
    expect(clientKey("203.0.113.7:5678")).toBe("203.0.113.7");
  });

  it("an IPv4-mapped IPv6 address is the IPv4 client, in either notation", () => {
    // Otherwise one client, arriving over a dual-stack socket, has two buckets.
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(clientKey("[::ffff:203.0.113.7]:80")).toBe("203.0.113.7");
    expect(clientKey("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("clientKey — not an address", () => {
  it("passes the value through, bounded; empty is 'unknown'", () => {
    expect(clientKey("not-an-ip")).toBe("not-an-ip");
    expect(clientKey("x".repeat(500))).toHaveLength(64);
    expect(clientKey("   ")).toBe("unknown");
    // Malformed v6 is not silently accepted as some other /64.
    expect(clientKey("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(clientKey("300.1.1.1")).toBe("300.1.1.1");
  });

  it("is idempotent, so a key can be passed where an address is expected", () => {
    for (const ip of ["203.0.113.7", "2001:db8:1:2::1", "::ffff:1.2.3.4", "unknown", "junk"]) {
      expect(clientKey(clientKey(ip))).toBe(clientKey(ip));
    }
  });
});

describe("voterId", () => {
  const SECRET = "test-secret";

  it("is HMAC-SHA256 of the client key under the secret, as 64 hex", () => {
    const v = voterId("2001:db8:1:2::99", SECRET);
    expect(v).toMatch(HASHED_VOTER_RE);
    expect(v).toBe(createHmac("sha256", SECRET).update("2001:db8:1:2::/64").digest("hex"));
    expect(v).toBe(hashClientKey("2001:db8:1:2::/64", SECRET));
  });

  it("one /64 is one voter; the address never appears in it", () => {
    expect(voterId("2001:db8:1:2::1", SECRET)).toBe(voterId("2001:db8:1:2::2", SECRET));
    expect(voterId("203.0.113.7", SECRET)).not.toContain("203.0.113.7");
  });

  it("depends on the secret", () => {
    expect(voterId("203.0.113.7", SECRET)).not.toBe(voterId("203.0.113.7", "other"));
  });

  it("refuses an empty secret rather than hashing under it", () => {
    expect(() => voterId("203.0.113.7", "")).toThrow();
  });
});
