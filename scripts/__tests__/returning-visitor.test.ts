import { describe, it, expect } from "vitest";
import { judgeRevisit, parseArgs, summary, NAVIGATION_NOISE } from "../returning-visitor.mjs";

/**
 * The returning-visitor check's verdict, without a browser. The browser half
 * was run for real against production on 2026-10-14 in Chromium and WebKit,
 * and its control (`--hold`, a second tab holding a write transaction) failed
 * as it must: the Library showed no rows within 25 s.
 */

const good = {
  browser: "webkit",
  primed: true,
  primedBuild: "aaa1111",
  build: "bbb2222",
  swControlledFirstLoad: true,
  libraryRows: 12,
  libraryMs: 900,
  libraryTimedOut: false,
  statsShown: true,
  statsMs: 400,
  statsTimedOut: false,
  pageErrors: [] as string[],
};

describe("judgeRevisit", () => {
  it("ok: rows, numbers, no timeout, no page error", () => {
    const v = judgeRevisit(good);
    expect(v).toEqual({ ok: true, problems: [] });
    expect(summary(good, v)).toBe("webkit: ok (aaa1111 -> bbb2222, old worker in control), Library 0.9s, Stats 0.4s");
  });

  it.each([
    [{ libraryRows: 0 }, /Library showed no rows/],
    [{ libraryTimedOut: true }, /Library said it was taking too long/],
    [{ statsShown: false }, /Stats showed no numbers/],
    [{ statsTimedOut: true }, /Stats said it was taking too long/],
    [{ pageErrors: ["TypeError: x is undefined"] }, /page errors: TypeError/],
    [{ primed: false }, /never primed/],
  ])("fails on %o", (change, problem) => {
    const v = judgeRevisit({ ...good, ...change });
    expect(v.ok).toBe(false);
    expect(v.problems.join("; ")).toMatch(problem);
  });

  it("WebKit's cut-off unload beacon is navigation noise, any other error is not", () => {
    const beacon = "Fetch API cannot load http://127.0.0.1:3003/api/stats/stop due to access control checks.";
    expect(NAVIGATION_NOISE.test(beacon)).toBe(true);
    expect(judgeRevisit({ ...good, pageErrors: [beacon] }).ok).toBe(true);
    expect(judgeRevisit({ ...good, pageErrors: [beacon, "ChunkLoadError"] }).ok).toBe(false);
  });
});

describe("parseArgs", () => {
  it("needs a mode, a browser it knows and a profile", () => {
    expect(parseArgs(["check", "--browser", "webkit", "--profile", "/p", "--hold"])).toMatchObject({
      mode: "check",
      browser: "webkit",
      profile: "/p",
      hold: true,
    });
    expect(() => parseArgs(["look", "--profile", "/p"])).toThrow();
    expect(() => parseArgs(["check", "--browser", "firefox", "--profile", "/p"])).toThrow();
    expect(() => parseArgs(["check"])).toThrow();
  });
});
