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

const { rateLimit, getClientIp, getClientKey, rateLimitStats, MAX_KEYS, SWEEP_INTERVAL_MS } =
  await import("../rate-limit");

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

describe("getClientKey — one budget per /64 (HD-007)", () => {
  it("two addresses in one /64 share a bucket", () => {
    const route = k("route");
    const opts = { maxRequests: 2, windowMs: 60_000 };
    const a = getClientKey(req({ "x-forwarded-for": "2001:db8:aa:1::1" }));
    const b = getClientKey(req({ "x-forwarded-for": "2001:db8:aa:1:dead:beef:0:7" }));
    expect(rateLimit(`${route}:${a}`, opts).allowed).toBe(true);
    expect(rateLimit(`${route}:${a}`, opts).allowed).toBe(true);
    // A fresh address from the same /64 is the same client, already spent.
    expect(rateLimit(`${route}:${b}`, opts).allowed).toBe(false);
  });

  it("different /64s do not", () => {
    const route = k("route");
    const opts = { maxRequests: 1, windowMs: 60_000 };
    const a = getClientKey(req({ "x-forwarded-for": "2001:db8:aa:1::1" }));
    const b = getClientKey(req({ "x-forwarded-for": "2001:db8:aa:2::1" }));
    expect(rateLimit(`${route}:${a}`, opts).allowed).toBe(true);
    expect(rateLimit(`${route}:${b}`, opts).allowed).toBe(true);
  });

  it("IPv4 stays per address, and a mapped address is that IPv4 client", () => {
    const route = k("route");
    const opts = { maxRequests: 1, windowMs: 60_000 };
    const v4 = getClientKey(req({ "x-forwarded-for": "198.51.100.20" }));
    const mapped = getClientKey(req({ "x-forwarded-for": "::ffff:198.51.100.20" }));
    const neighbour = getClientKey(req({ "x-forwarded-for": "198.51.100.21" }));
    expect(rateLimit(`${route}:${v4}`, opts).allowed).toBe(true);
    expect(rateLimit(`${route}:${mapped}`, opts).allowed).toBe(false);
    expect(rateLimit(`${route}:${neighbour}`, opts).allowed).toBe(true);
  });
});

describe("rateLimit — bounded under a flood", () => {
  it("the Map never exceeds MAX_KEYS, and a client limited before the flood is still limited after", () => {
    const opts = { maxRequests: 3, windowMs: 60_000 };
    const victim = k("limited-before-flood");
    for (let i = 0; i < 3; i++) rateLimit(victim, opts);
    expect(rateLimit(victim, opts).allowed).toBe(false);

    // 100k distinct keys, each one request: the shape of someone cycling
    // through addresses to be a new client every time.
    let peak = 0;
    for (let i = 0; i < 100_000; i++) {
      rateLimit(`flood-a-${i}`, opts);
      peak = Math.max(peak, rateLimitStats().size);
    }
    expect(peak).toBeLessThanOrEqual(MAX_KEYS);
    expect(peak).toBe(MAX_KEYS); // actually full, or the bound was never tested

    // Eviction takes entries that are not limiting anyone. The victim's block
    // survived 100k newcomers, so flooding is not a way to reset a limit.
    expect(rateLimit(victim, opts).allowed).toBe(false);
  });

  it("the bound holds even when every entry is blocking — memory wins over memory of the block", () => {
    // maxRequests 1: every flood key is at its limit after one request, so the
    // eviction scan finds nothing non-blocking and must fall back.
    for (let i = 0; i < 30_000; i++) rateLimit(`flood-b-${i}`, { maxRequests: 1, windowMs: 60_000 });
    expect(rateLimitStats().size).toBeLessThanOrEqual(MAX_KEYS);
  });

  it("evicting a non-blocking entry forgets its partial count — the documented cost", () => {
    const opts = { maxRequests: 3, windowMs: 60_000 };
    const partial = k("partial");
    rateLimit(partial, opts);
    rateLimit(partial, opts); // 2 of 3 spent, not blocking
    for (let i = 0; i < MAX_KEYS; i++) rateLimit(`flood-c-${i}`, opts);
    // Evicted: it has a fresh budget of 3, not the 1 it had left.
    expect(rateLimit(partial, opts).remaining).toBe(2);
  });
});

describe("rateLimit — the sweep is off the request path", () => {
  it("no request runs the sweep, however much time passes between them", () => {
    const before = rateLimitStats().sweeps;
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      // setSystemTime moves the clock without firing timers, so only a sweep
      // called from inside rateLimit() could run here.
      vi.setSystemTime(t0 + i * 10 * 60_000);
      rateLimit(k("no-sweep"), { maxRequests: 5 });
    }
    expect(rateLimitStats().sweeps).toBe(before);
    // The clock is left where it is: winding it back would leave entries
    // stamped in the future, which no sweep could ever reclaim.
  });

  it("the interval sweeps, and reclaims entries whose window has passed", () => {
    rateLimit(k("expires"), { maxRequests: 5, windowMs: 1000 });
    const before = rateLimitStats();
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
    const after = rateLimitStats();
    expect(after.sweeps).toBe(before.sweeps + 1);
    // Everything above used windows of at most 60s and SWEEP_INTERVAL_MS has
    // now passed with no traffic, so the sweep leaves nothing behind.
    expect(after.size).toBeLessThan(before.size);
    expect(after.size).toBe(0);
  });
});
