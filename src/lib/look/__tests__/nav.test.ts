// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DIAL_HREF, DIAL_LABEL, showsNavPath } from "../nav";
import { parseLibraryIntent } from "@/lib/library/intents";

/** Navigation (src/lib/look/nav.ts): no Radio tab; the dial is a Library mode. */

const TABS = ["/library", "/live", "/radio", "/scanner", "/search", "/stats"];
const shown = (admin: boolean) => TABS.filter((p) => showsNavPath(p, admin));

describe("navigation", () => {
  it("drops the Radio tab and hides the admin tools from everyone else", () => {
    expect(shown(false)).toEqual(["/library", "/live", "/stats"]);
    expect(shown(true)).toEqual(["/library", "/live", "/scanner", "/search", "/stats"]);
  });

  it("the dial is the Library's Dial mode, by a library intent", () => {
    expect(DIAL_LABEL).toBe("Library Dial");
    const url = new URL(DIAL_HREF, "https://highdesert.space");
    expect(url.pathname).toBe("/library");
    expect(parseLibraryIntent(url.searchParams)).toEqual({ view: "dial" });
  });
});
