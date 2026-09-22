/**
 * Who a request is from, for the purposes of counting — never for storing.
 *
 * An IPv4 address identifies (at most) one household. An IPv6 address does
 * not: the smallest allocation an ISP hands a customer is a /64, and a single
 * machine inside it can mint as many addresses as it likes. Keying anything on
 * the full v6 address therefore gave anyone with an ordinary home connection
 * 2^64 identities — an unlimited rate limit, an unlimited presence count, and an
 * unlimited number of rating ballots (HD-007). So:
 *
 *   - IPv4                 → the address itself, canonicalised (`1.2.3.4`)
 *   - IPv4-mapped IPv6     → the embedded IPv4 (`::ffff:1.2.3.4` is `1.2.3.4`,
 *                            or the same client has two buckets)
 *   - IPv6                 → its /64 prefix (`2001:db8:0:1::/64`)
 *   - anything else        → passed through, trimmed and bounded
 *
 * Bracket (`[2001:db8::1]`, `[2001:db8::1]:443`), port (`1.2.3.4:5678`) and
 * zone (`fe80::1%eth0`) forms are accepted, because a header is only as tidy
 * as whatever wrote it.
 *
 * The pass-through is deliberate. nginx overwrites X-Forwarded-For with
 * `$remote_addr`, so in production this only ever sees a real address; in dev
 * with no proxy it sees nothing and returns "unknown". Trusting the header is
 * nginx's job, not this function's.
 *
 * This file is imported by `scripts/migrate-hash-voters.mjs` under Node's
 * native type stripping, so it must not use `@/` imports or non-erasable TS
 * syntax (enums, parameter properties, namespaces). The migration and the rate
 * route have to hash with *the same function*, not two copies of it.
 */

import { createHmac } from "node:crypto";

/** Longest non-address key kept verbatim; bounds memory for junk headers. */
const MAX_OPAQUE_KEY = 64;

function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Eight 16-bit groups, or null if `s` is not an IPv6 address. */
function parseIpv6(s: string): number[] | null {
  let text = s.toLowerCase();

  // A trailing dotted quad (`::ffff:1.2.3.4`) is the last 32 bits.
  let tail: number[] = [];
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const v4 = parseIpv4(dotted[2]);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const group = (part: string) => (part === "" ? [] : part.split(":"));
  const head = group(halves[0]);
  const rest = halves.length === 2 ? group(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;

  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    if (explicit !== 8) return null;
  } else if (explicit > 7) {
    // `::` stands for at least one zero group.
    return null;
  }
  const zeros = new Array(8 - explicit).fill(0);
  const hex = (g: string) => parseInt(g, 16);
  return [...head.map(hex), ...(halves.length === 2 ? zeros : []), ...rest.map(hex), ...tail];
}

/**
 * The bucket a client address belongs to. See the file header for the rules.
 */
export function clientKey(raw: string): string {
  let s = raw.trim();
  if (s === "") return "unknown";

  // [v6] or [v6]:port
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  // v4:port — only a single colon, so it cannot be mistaken for v6.
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (v4port) s = v4port[1];
  // Zone id: meaningful only on the host that wrote it.
  const pct = s.indexOf("%");
  if (pct > 0 && s.includes(":")) s = s.slice(0, pct);

  const v4 = parseIpv4(s);
  if (v4) return v4.join(".");

  const v6 = parseIpv6(s);
  if (v6) {
    const mapped = v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff;
    if (mapped) {
      return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff].join(".");
    }
    return `${v6.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
  }

  return s.slice(0, MAX_OPAQUE_KEY);
}

/** HMAC-SHA256 of a client key under `secret`, as 64 lowercase hex chars. */
export function hashClientKey(key: string, secret: string): string {
  return createHmac("sha256", secret).update(key).digest("hex");
}

/**
 * What `rating_votes.voter` holds: the HMAC of the client's bucket (the /64 for
 * IPv6), never the address (HD-008). One function for the rate route and the
 * one-time migration, so a vote cast before and after it land on the same row.
 */
export function voterId(ip: string, secret: string): string {
  if (!secret) throw new Error("voterId needs a secret");
  return hashClientKey(clientKey(ip), secret);
}

/** A stored voter that is already a hash — the migration's skip test. */
export const HASHED_VOTER_RE = /^[0-9a-f]{64}$/;
