// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, isLook, lookCookie, lookFrom, lookFromCookieString, LOOKS } from "../look";

describe("looks", () => {
  it("Win98 is the default, Night the alternative, and nothing else is a look", () => {
    expect(DEFAULT_LOOK).toBe("win98");
    expect([...LOOKS]).toEqual(["win98", "night"]);
    for (const v of ["default", "clean", "", "WIN98", undefined, null]) expect(isLook(v)).toBe(false);
  });

  it("reads a choice, or falls back to the default", () => {
    expect(lookFrom("night")).toBe("night");
    expect(lookFrom("clean")).toBe("win98");
    expect(lookFrom(undefined)).toBe("win98");
    expect(lookFromCookieString("a=1; hd_look=night; b=2")).toBe("night");
    expect(lookFromCookieString("hd_look_view=night")).toBe("win98");
    expect(lookFromCookieString("")).toBe("win98");
  });

  it("remembers a choice for 400 days, site-wide", () => {
    const c = lookCookie("night", true);
    expect(c).toMatch(/^hd_look=night; Path=\/; Max-Age=34560000; SameSite=Lax; Secure$/);
    expect(lookCookie("win98", false)).not.toMatch(/Secure/);
    expect(lookFromCookieString(c.split(";")[0])).toBe("night");
  });
});
