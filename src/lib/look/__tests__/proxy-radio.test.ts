// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { lookKeyHex, lookValue } from "../../../../services/live/lib/look.mjs";

/** /radio in a preview look is the Library's Dial mode (src/lib/look/nav.ts). */

const TOKEN = "ef".repeat(32);
const req = (path: string, cookie?: string) =>
  new NextRequest(`https://highdesert.space${path}`, { headers: cookie ? { cookie } : {} });
const target = (res: Response) => {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const u = new URL(loc);
  return u.pathname + u.search;
};

describe("proxy: /radio per look", () => {
  beforeEach(() => { process.env.HD_LOOK_KEY = lookKeyHex(TOKEN); });
  afterEach(() => { delete process.env.HD_LOOK_KEY; });

  it("a preview look is sent to the Library's Dial mode, with its view cookie", async () => {
    for (const look of ["clean", "win98"] as const) {
      const res = await proxy(req("/radio", `hd_look=${lookValue(TOKEN, look)}`));
      expect(res.status).toBe(307);
      expect(target(res)).toBe("/library?view=dial");
      expect(res.headers.getSetCookie().join("\n")).toMatch(new RegExp(`hd_look_view=${look}`));
    }
  });

  it("control: the public look keeps /radio", async () => {
    const res = await proxy(req("/radio"));
    expect(target(res)).toBeNull();
    expect(res.status).toBe(200);
  });

  it("an unsigned view cookie does not redirect", async () => {
    const res = await proxy(req("/radio", "hd_look_view=clean"));
    expect(target(res)).toBeNull();
  });

  it("other pages are not redirected in a preview look", async () => {
    const res = await proxy(req("/library", `hd_look=${lookValue(TOKEN, "clean")}`));
    expect(target(res)).toBeNull();
  });
});
