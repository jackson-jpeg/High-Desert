// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { lookKeyHex, lookValue } from "../../../../services/live/lib/look.mjs";

const TOKEN = "ef".repeat(32);

function req(cookie?: string) {
  return new NextRequest("https://highdesert.space/library", { headers: cookie ? { cookie } : {} });
}

describe("proxy: the view cookie follows the signed one", () => {
  beforeEach(() => { process.env.HD_LOOK_KEY = lookKeyHex(TOKEN); });
  afterEach(() => { delete process.env.HD_LOOK_KEY; });

  it("a public visitor's request passes through with no cookie set", async () => {
    const res = await proxy(req());
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("a signed look sets the view cookie", async () => {
    const res = await proxy(req(`hd_look=${lookValue(TOKEN, "win98")}`));
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/hd_look_view=win98/);
    expect(set).toMatch(/Path=\//);
  });

  it("a hand-written view cookie is deleted", async () => {
    const res = await proxy(req("hd_look_view=win98"));
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/hd_look_view=;/);
  });

  it("without HD_LOOK_KEY no look is honoured", async () => {
    delete process.env.HD_LOOK_KEY;
    const res = await proxy(req(`hd_look=${lookValue(TOKEN, "win98")}; hd_look_view=win98`));
    expect(res.headers.getSetCookie().join("\n")).toMatch(/hd_look_view=;/);
  });
});
