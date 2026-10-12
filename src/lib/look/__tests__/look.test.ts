// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lookFromCookieString, signLook, verifyLook } from "../look";
// The signer that production actually uses: the phone lines' admin route.
import { lookCookie, lookKeyHex, lookValue } from "../../../../services/live/lib/look.mjs";

const TOKEN = "ab".repeat(32);
const KEY = lookKeyHex(TOKEN);

describe("the preview look cookie", () => {
  it("a look the live service signs is the look the app verifies", async () => {
    const now = Date.now();
    expect(await verifyLook(lookValue(TOKEN, "win98", now), KEY, now)).toBe("win98");
    expect(await verifyLook(lookValue(TOKEN, "clean", now), KEY, now)).toBe("clean");
  });

  it("the app's own signer agrees with the service's", async () => {
    const exp = Date.now() + 60_000;
    const v = await signLook("clean", exp, KEY);
    expect(await verifyLook(v, KEY)).toBe("clean");
  });

  it("refuses a forged, edited, expired or unkeyed value", async () => {
    const now = Date.now();
    const good = lookValue(TOKEN, "win98", now);
    expect(await verifyLook(good.replace("win98", "clean"), KEY, now)).toBeNull();
    expect(await verifyLook(lookValue("cd".repeat(32), "win98", now), KEY, now)).toBeNull();
    expect(await verifyLook(good, KEY, now + 31 * 24 * 60 * 60_000)).toBeNull();
    expect(await verifyLook(good, undefined, now)).toBeNull();
    expect(await verifyLook("win98", KEY, now)).toBeNull();
    expect(await verifyLook(undefined, KEY, now)).toBeNull();
  });

  it("a cookie is set for a preview and cleared for anything else", () => {
    expect(lookCookie(TOKEN, "win98")).toMatch(/^hd_look=v1\.win98\.\d+\.[0-9a-f]{64}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
    expect(lookCookie(TOKEN, "default")).toMatch(/^hd_look=; Path=\/; Max-Age=0/);
    expect(lookCookie(TOKEN, "<script>")).toMatch(/Max-Age=0/);
  });

  it("only the view cookie, and only a known look, chooses a look in the page", () => {
    expect(lookFromCookieString("a=1; hd_look_view=win98")).toBe("win98");
    expect(lookFromCookieString("hd_look_view=clean")).toBe("clean");
    expect(lookFromCookieString("hd_look_view=evil")).toBe("default");
    expect(lookFromCookieString("hd_look=v1.win98.1.x")).toBe("default");
    expect(lookFromCookieString("")).toBe("default");
  });
});
