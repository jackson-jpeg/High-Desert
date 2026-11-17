import { networkInterfaces } from "node:os";
import { isBotUserAgent } from "@/lib/utils/bot";
import { getClientIp } from "@/lib/utils/rate-limit";

/**
 * A request that is not the audience (sang3r.com lead, 2026-11-17): the
 * audience counters (visitors, views, arrivals, the funnel, minutes per tab)
 * skip it, applied before counting. Going forward only: the tables are
 * counters and keep no address or user agent, so earlier days cannot be
 * re-filtered.
 *
 *   - an agent's user agent (isBotUserAgent: crawlers, HeadlessChrome,
 *     Playwright, curl, python, node, SangerLeadAudit);
 *   - the `X-Sanger-Internal` header, sent by sang3r.com's own checks;
 *   - the `sanger_me=1` cookie, Jackson's "don't count me" (set by /_me);
 *   - a request from this box itself: loopback, or any of its own addresses
 *     (a check on the VPS that goes out through public DNS comes back from the
 *     box's public address).
 *
 * The answer to an excluded request is the same `{ok: true}` as any other, so
 * a check that posts sees no difference; nothing is stored.
 */

export const INTERNAL_HEADER = "x-sanger-internal";
export const ME_COOKIE = "sanger_me";

let own: Set<string> | null = null;

/** This box's own addresses, read once: loopback and every interface's. */
export function ownAddresses(): Set<string> {
  if (own) return own;
  const s = new Set<string>(["127.0.0.1", "::1"]);
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) s.add(a.address);
    }
  } catch {
    /* no interfaces readable: loopback still counts as the box */
  }
  own = s;
  return own;
}

function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  return v.startsWith("::ffff:") && v.includes(".") ? v.slice(7) : v;
}

export function hasMeCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return new RegExp(`(?:^|;\\s*)${ME_COOKIE}=1(?:;|$)`).test(cookieHeader);
}

export function isNotAudience(request: Request, addresses: Set<string> = ownAddresses()): boolean {
  const h = request.headers;
  if (isBotUserAgent(h.get("user-agent"))) return true;
  if (h.has(INTERNAL_HEADER)) return true;
  if (hasMeCookie(h.get("cookie"))) return true;
  const ip = normalizeIp(getClientIp(request));
  return ip !== "" && ip !== "unknown" && addresses.has(ip);
}
