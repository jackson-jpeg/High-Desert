import { describe, it, expect } from "vitest";
import { PHONE_LINES_HREF, wantsPhoneLines } from "@/lib/live/phone-lines";
import { PHONE_LINES_HREF as START_MENU_HREF } from "@/components/looks/win98/start-menu";
import manifest from "../../../../public/manifest.json";

/** "Phone Lines" is one URL in both looks (src/lib/live/phone-lines.ts). */
describe("the Phone Lines URL", () => {
  it("is the Live screen asking for the lines, and the screen recognises it", () => {
    expect(PHONE_LINES_HREF).toBe("/live?lines=1");
    expect(wantsPhoneLines(new URLSearchParams(PHONE_LINES_HREF.split("?")[1]))).toBe(true);
  });

  it("ignores anything else", () => {
    expect(wantsPhoneLines(new URLSearchParams(""))).toBe(false);
    expect(wantsPhoneLines(new URLSearchParams("lines=0"))).toBe(false);
    expect(wantsPhoneLines(new URLSearchParams("lines=yes"))).toBe(false);
    expect(wantsPhoneLines(null)).toBe(false);
  });

  it("is the same URL from Win98's Start menu and from the installed app's shortcut", () => {
    expect(START_MENU_HREF).toBe(PHONE_LINES_HREF);
    expect(manifest.shortcuts.map((s) => s.url)).toContain(PHONE_LINES_HREF);
  });
});
