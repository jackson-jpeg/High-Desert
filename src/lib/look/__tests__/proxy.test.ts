// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * The proxy's part of the looks (src/proxy.ts). The rewrite into the look is
 * next.config.ts's (see its comment), and is held by e2e/looks.spec.ts
 * against a real server: the HTML names the look the cookie asked for.
 */

function req(path: string, cookie?: string) {
  return new NextRequest(`https://highdesert.space${path}`, { headers: cookie ? { cookie } : {} });
}

describe("proxy", () => {
  it("a visitor with no cookie, or a valid one, passes through untouched", () => {
    for (const c of [undefined, "hd_look=win98", "hd_look=night"]) {
      const res = proxy(req("/library", c));
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("an unknown value (the old signed preview cookie) is removed", () => {
    const res = proxy(req("/stats", "hd_look=v1.clean.1791700000000." + "ab".repeat(32)));
    expect(res.headers.getSetCookie().join("\n")).toMatch(/hd_look=;/);
  });

  it("the old preview's view cookie is removed", () => {
    const set = proxy(req("/stats", "hd_look_view=win98")).headers.getSetCookie().join("\n");
    expect(set).toMatch(/hd_look_view=;/);
  });

  it("a path that names a look goes to the page's one URL", () => {
    for (const [from, to] of [["/night/library", "/library"], ["/win98", "/"], ["/night/show/x?t=5", "/show/x?t=5"]]) {
      const res = proxy(req(from));
      expect(res.status, from).toBe(308);
      expect(res.headers.get("location"), from).toBe(`https://highdesert.space${to}`);
    }
    expect(proxy(req("/nightlife")).status).not.toBe(308);
  });

  it("/radio is the Library's Dial mode, permanently", () => {
    const res = proxy(req("/radio", "hd_look=night"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://highdesert.space/library?view=dial");
  });
});
