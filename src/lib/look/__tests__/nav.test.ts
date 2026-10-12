// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DIAL_HREF, dialHref, dialLabel, radioRetired, showsNavPath } from "../nav";
import { LOOKS, PREVIEW_LOOKS } from "../look";
import { parseLibraryIntent } from "@/lib/library/intents";

/**
 * The Radio tab per look (src/lib/look/nav.ts). The public look must keep it
 * exactly as it is; both preview looks retire it for the Library's Dial mode.
 */

const TABS = ["/library", "/live", "/radio", "/scanner", "/search", "/stats"];
const shown = (look: (typeof LOOKS)[number], admin: boolean) => TABS.filter((p) => showsNavPath(p, look, admin));

describe("navigation per look", () => {
  it("the public look keeps every tab it has today", () => {
    expect(radioRetired("default")).toBe(false);
    expect(shown("default", false)).toEqual(["/library", "/live", "/radio", "/stats"]);
    expect(shown("default", true)).toEqual(TABS);
    expect(dialHref("default")).toBe("/radio");
    expect(dialLabel("default")).toBe("Radio Dial");
  });

  it("each preview look drops the Radio tab and nothing else", () => {
    for (const look of PREVIEW_LOOKS) {
      expect(radioRetired(look)).toBe(true);
      expect(shown(look, false)).toEqual(["/library", "/live", "/stats"]);
      expect(shown(look, true)).toEqual(["/library", "/live", "/scanner", "/search", "/stats"]);
    }
  });

  it("in a preview look the dial is the Library's Dial mode, by a library intent", () => {
    for (const look of PREVIEW_LOOKS) {
      expect(dialHref(look)).toBe(DIAL_HREF);
      expect(dialLabel(look)).toBe("Library Dial");
    }
    const url = new URL(DIAL_HREF, "https://highdesert.space");
    expect(url.pathname).toBe("/library");
    expect(parseLibraryIntent(url.searchParams)).toEqual({ view: "dial" });
  });
});
