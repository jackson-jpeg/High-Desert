// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasMeCookie, isNotAudience } from "../not-audience";
import { isBotUserAgent } from "../bot";

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const OWN = new Set(["127.0.0.1", "::1", "203.0.113.7"]);

function req(headers: Record<string, string>): Request {
  return new Request("https://highdesert.space/api/stats/view", { method: "POST", headers });
}
const listener = (extra: Record<string, string> = {}) => req({ "user-agent": SAFARI, "x-forwarded-for": "198.51.100.4", ...extra });

describe("isNotAudience", () => {
  it("counts a listener's browser (the control)", () => {
    expect(isNotAudience(listener(), OWN)).toBe(false);
  });

  it("drops the agents the sang3r lead named, and a missing user agent", () => {
    for (const ua of [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
      "Playwright/1.49.0",
      "Mozilla/5.0 (compatible; SangerLeadAudit/1.0)",
      "curl/8.5.0",
      "python-requests/2.32.3",
      "Python-urllib/3.12",
      "node",
      "node/22.11.0",
      "undici",
    ]) {
      expect(isNotAudience(listener({ "user-agent": ua }), OWN), ua).toBe(true);
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
    expect(isNotAudience(req({ "x-forwarded-for": "198.51.100.4" }), OWN)).toBe(true);
  });

  it("does not mistake a browser for node (Android, a word containing node)", () => {
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")).toBe(false);
  });

  it("drops sang3r.com's own checks by header", () => {
    expect(isNotAudience(listener({ "x-sanger-internal": "1" }), OWN)).toBe(true);
  });

  it("drops Jackson by the sanger_me=1 cookie, and only that value", () => {
    expect(isNotAudience(listener({ cookie: "hd_look=night; sanger_me=1" }), OWN)).toBe(true);
    expect(hasMeCookie("sanger_me=1")).toBe(true);
    expect(hasMeCookie("sanger_me=0")).toBe(false);
    expect(hasMeCookie("xsanger_me=1")).toBe(false);
    expect(isNotAudience(listener({ cookie: "sanger_me=0" }), OWN)).toBe(false);
  });

  it("drops a request from this box: loopback, an own address, a v4-mapped one", () => {
    expect(isNotAudience(listener({ "x-forwarded-for": "127.0.0.1" }), OWN)).toBe(true);
    expect(isNotAudience(listener({ "x-forwarded-for": "203.0.113.7" }), OWN)).toBe(true);
    expect(isNotAudience(listener({ "x-forwarded-for": "::ffff:203.0.113.7" }), OWN)).toBe(true);
    // No address at all (a direct call without the proxy) is not the box by itself.
    expect(isNotAudience(req({ "user-agent": SAFARI }), OWN)).toBe(false);
  });
});
