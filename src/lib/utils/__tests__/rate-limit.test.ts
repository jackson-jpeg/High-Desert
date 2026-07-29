import { describe, it, expect, vi } from "vitest";

/**
 * The rate limiter is an in-memory Map, which is correct here — one long-lived
 * `next start` process, not serverless — and it is the only thing standing
 * between the public API routes and someone holding down a script.
 *
 * Time is faked before the import so `lastCleanup`, which is initialised at
 * module scope from `Date.now()`, starts at a known point.
 */
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-29T00:00:00Z"));

const { rateLimit, getClientIp } = await import("../rate-limit");

/** The store is module-level and never reset, so every test needs its own key. */
let keySeq = 0;
const k = (name: string) => `${name}-${++keySeq}`;

function req(headers: Record<string, string>): Request {
  return new Request("https://highdesert.space/api/stats/play", { headers });
}

describe("rateLimit — the limit itself", () => {
  it("allows exactly maxRequests and refuses the next one", () => {
    const key = k("burst");
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, { maxRequests: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
    // The boundary is the whole point: off by one here is either a limiter that
    // lets an extra request through every window, or one that refuses a request
    // the caller was entitled to.
    expect(rateLimit(key, { maxRequests: 3, windowMs: 60_000 }).allowed).toBe(false);
  });

  it("counts down remaining, and reports 0 once blocked", () => {
    const key = k("remaining");
    const opts = { maxRequests: 3, windowMs: 60_000 };
    expect(rateLimit(key, opts).remaining).toBe(2);
    expect(rateLimit(key, opts).remaining).toBe(1);
    expect(rateLimit(key, opts).remaining).toBe(0);

    const blocked = rateLimit(key, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("keys are independent — one caller cannot exhaust another's budget", () => {
    const a = k("ip-a");
    const b = k("ip-b");
    const opts = { maxRequests: 2, windowMs: 60_000 };

    rateLimit(a, opts);
    rateLimit(a, opts);
    expect(rateLimit(a, opts).allowed).toBe(false);

    // b has spent nothing.
    expect(rateLimit(b, opts).allowed).toBe(true);
  });

  it("an allowed request reports no retry delay", () => {
    expect(rateLimit(k("clean"), { maxRequests: 2 }).retryAfterMs).toBe(0);
  });
});

describe("rateLimit — the window slides", () => {
  it("frees one slot as the oldest request ages out, not all of them at once", () => {
    // This is what separates a sliding window from a fixed bucket. A fixed
    // bucket would hand back the full allowance at the boundary, which is how a
    // "30/min" limit quietly becomes 60 requests in a two-second span.
    const key = k("sliding");
    const opts = { maxRequests: 2, windowMs: 1000 };
    const t0 = Date.now();

    expect(rateLimit(key, opts).allowed).toBe(true); // t=0
    vi.setSystemTime(t0 + 500);
    expect(rateLimit(key, opts).allowed).toBe(true); // t=500
    vi.setSystemTime(t0 + 600);
    expect(rateLimit(key, opts).allowed).toBe(false); // both still in window

    // t=1100: the t=0 request has expired, the t=500 one has not.
    vi.setSystemTime(t0 + 1100);
    const freed = rateLimit(key, opts);
    expect(freed.allowed).toBe(true);
    // Exactly one slot came back, so we are immediately at the limit again.
    expect(freed.remaining).toBe(0);
    expect(rateLimit(key, opts).allowed).toBe(false);

    vi.setSystemTime(t0);
  });

  it("retryAfterMs is measured from the oldest request, not from now", () => {
    const key = k("retry-after");
    const opts = { maxRequests: 1, windowMs: 10_000 };
    const t0 = Date.now();

    rateLimit(key, opts); // t=0
    vi.setSystemTime(t0 + 4000);

    // The blocking request expires at t=10000, and it is t=4000.
    expect(rateLimit(key, opts).retryAfterMs).toBe(6000);

    vi.setSystemTime(t0);
  });
});

describe("getClientIp", () => {
  it("takes the first entry of x-forwarded-for and trims it", () => {
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe(
      "203.0.113.7",
    );
    expect(getClientIp(req({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(getClientIp(req({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(getClientIp(req({}))).toBe("unknown");
  });

  it("an empty x-forwarded-for falls through rather than yielding an empty key", () => {
    // An empty string as the key would put every such caller into one shared
    // bucket, which is a denial of service against everyone in it.
    expect(getClientIp(req({ "x-forwarded-for": "", "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });

  it("returns whatever the header says — trusting it is nginx's job, not this function's", () => {
    // Documented rather than defended: the deployment depends on nginx setting
    // X-Forwarded-For to $remote_addr by OVERWRITE. If that ever becomes an
    // append, this returns the client-supplied value and the limiter is
    // bypassable by anyone who sends the header. See CLAUDE.md, deployment.
    expect(getClientIp(req({ "x-forwarded-for": "not-an-ip" }))).toBe("not-an-ip");
  });
});
