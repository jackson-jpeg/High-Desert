import { describe, it, expect } from "vitest";
import {
  parseLibraryIntent,
  libraryIntentHref,
  hasIntent,
  hasIntentParams,
  withoutIntentParams,
  LIBRARY_VIEWS,
} from "@/lib/library/intents";

/**
 * `?view=list|dial`: how the library browses (the dial is a preview-look
 * mode, src/lib/look/nav.ts). Same rules as the other intents: strict,
 * silent, and cleared from the address bar either way.
 */

const parse = (qs: string) => parseLibraryIntent(new URLSearchParams(qs));

describe("the view intent", () => {
  it("reads list and dial", () => {
    expect(LIBRARY_VIEWS).toEqual(["list", "dial"]);
    expect(parse("view=dial")).toEqual({ view: "dial" });
    expect(parse("view=list")).toEqual({ view: "list" });
    expect(parse("view=dial&sort=name")).toEqual({ view: "dial", sort: "name" });
  });

  it("ignores anything else", () => {
    expect(parse("view=Dial")).toEqual({});
    expect(parse("view=radio")).toEqual({});
    expect(parse("view=")).toEqual({});
    expect(parse("view=grid&shuffle=coast")).toEqual({ shuffle: "coast" });
  });

  it("counts as an intent, and is cleared like one", () => {
    expect(hasIntent({ view: "dial" })).toBe(true);
    expect(hasIntentParams(new URLSearchParams("view=bogus"))).toBe(true);
    expect(withoutIntentParams("?view=dial&viewer")).toBe("?viewer=");
  });

  it("builds the URL, after the other intents", () => {
    expect(libraryIntentHref({ view: "dial" })).toBe("/library?view=dial");
    expect(libraryIntentHref({ view: "dial", sort: "date" })).toBe("/library?sort=date&view=dial");
    expect(parse(libraryIntentHref({ view: "list" }).split("?")[1])).toEqual({ view: "list" });
  });
});
