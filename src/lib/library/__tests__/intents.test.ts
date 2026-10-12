import { describe, it, expect } from "vitest";
import {
  parseLibraryIntent,
  libraryIntentHref,
  hasIntent,
  hasIntentParams,
  withoutIntentParams,
  MAX_QUERY_LENGTH,
  SHUFFLE_SCOPES,
} from "@/lib/library/intents";
import { SORT_MODES } from "@/lib/library/filter-episodes";

/**
 * Library intents in the URL (HD-013). The parser is the gate between an
 * address bar anyone can edit and actions that start audio, so the invalid
 * cases matter as much as the valid ones.
 */

const parse = (qs: string) => parseLibraryIntent(new URLSearchParams(qs));

describe("parseLibraryIntent", () => {
  it("reads each intent", () => {
    expect(parse("shuffle=coast")).toEqual({ shuffle: "coast" });
    expect(parse("sort=played")).toEqual({ sort: "played" });
    expect(parse("q=ghost%20to%20ghost")).toEqual({ q: "ghost to ghost" });
    expect(parse("scroll=current")).toEqual({ scroll: "current" });
    expect(parse("sort=name&shuffle=all&q=ufo&scroll=current")).toEqual({
      sort: "name",
      shuffle: "all",
      q: "ufo",
      scroll: "current",
    });
  });

  it("accepts every sort mode the library has, from its own list", () => {
    for (const mode of SORT_MODES) expect(parse(`sort=${mode}`)).toEqual({ sort: mode });
  });

  it("accepts every shuffle scope, and the three show types the menus offer", () => {
    for (const scope of SHUFFLE_SCOPES) expect(parse(`shuffle=${scope}`)).toEqual({ shuffle: scope });
    expect(SHUFFLE_SCOPES).toEqual(expect.arrayContaining(["all", "coast", "dreamland"]));
  });

  it("ignores invalid values instead of guessing", () => {
    expect(parse("sort=newest")).toEqual({});
    expect(parse("sort=DATE")).toEqual({});
    expect(parse("sort=")).toEqual({});
    expect(parse("shuffle=unknown")).toEqual({});
    expect(parse("shuffle=Coast")).toEqual({});
    expect(parse("shuffle=")).toEqual({});
    expect(parse("scroll=top")).toEqual({});
    expect(parse("q=%20%20")).toEqual({});
    expect(parse("q=")).toEqual({});
    expect(parse("viewer&page=2")).toEqual({});
    // A bad value does not spoil a good one beside it.
    expect(parse("sort=bogus&shuffle=dreamland")).toEqual({ shuffle: "dreamland" });
  });

  it("trims the search and bounds its length", () => {
    expect(parse("q=%20%20ufo%20")).toEqual({ q: "ufo" });
    expect(parse(`q=${"a".repeat(MAX_QUERY_LENGTH + 50)}`).q).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("the show intent (a show page's Open in High Desert)", () => {
  const key = "ultimate-ultimate-art-bell-collection--1992-12-12_-_Coast_to_Coast_AM_with_Art_Bell_-_Area_51";

  it("reads a community key", () => {
    expect(parse(`show=${key}`)).toEqual({ show: key });
    expect(libraryIntentHref({ show: key })).toBe(`/library?show=${key}`);
    expect(parse(libraryIntentHref({ show: key }).split("?")[1])).toEqual({ show: key });
  });

  it("ignores anything a community key cannot be", () => {
    expect(parse("show=")).toEqual({});
    expect(parse("show=no-separator")).toEqual({});
    expect(parse("show=a--b%20c")).toEqual({});
    expect(parse("show=%3Cscript%3E--x")).toEqual({});
    expect(parse(`show=coll--${"a".repeat(121)}`)).toEqual({});
    expect(hasIntentParams(new URLSearchParams("show=bogus"))).toBe(true);
    expect(withoutIntentParams(`show=${key}&viewer=`)).toBe("?viewer=");
  });
});

describe("hasIntent / hasIntentParams", () => {
  it("tells an intent from none, and an invalid parameter from an absent one", () => {
    expect(hasIntent(parse("shuffle=coast"))).toBe(true);
    expect(hasIntent(parse("shuffle=bogus"))).toBe(false);
    // Invalid, but still in the URL — it must still be cleared.
    expect(hasIntentParams(new URLSearchParams("shuffle=bogus"))).toBe(true);
    expect(hasIntentParams(new URLSearchParams("viewer"))).toBe(false);
  });
});

describe("libraryIntentHref", () => {
  it("builds the URL the parser reads back", () => {
    expect(libraryIntentHref({ shuffle: "coast" })).toBe("/library?shuffle=coast");
    expect(libraryIntentHref({ q: "tag:ufo" })).toBe("/library?q=tag%3Aufo");
    expect(libraryIntentHref({})).toBe("/library");
    for (const intent of [
      { sort: "rated" as const },
      { shuffle: "dreamland" as const, scroll: "current" as const },
      { q: "ghost to ghost" },
    ]) {
      const href = libraryIntentHref(intent);
      expect(parse(href.split("?")[1])).toEqual(intent);
    }
  });
});

describe("withoutIntentParams", () => {
  it("clears the intent and keeps everything else", () => {
    expect(withoutIntentParams("shuffle=coast")).toBe("");
    expect(withoutIntentParams("sort=bogus&q=x&scroll=current&shuffle=all")).toBe("");
    expect(withoutIntentParams("viewer=&shuffle=coast")).toBe("?viewer=");
  });
});
