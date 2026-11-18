import { describe, it, expect } from "vitest";
import { firstSort, NEW_VISITOR_SORT } from "@/lib/library/first-sort";

describe("firstSort", () => {
  it("a new visitor (nothing stored, no history) opens on Most played", () => {
    expect(NEW_VISITOR_SORT).toBe("played");
    expect(firstSort({ stored: null, hasHistory: false, isDesktop: true })).toBe("played");
  });

  it("a phone keeps the default (left alone until the look split's verdict)", () => {
    expect(firstSort({ stored: null, hasHistory: false, isDesktop: false })).toBeNull();
    expect(firstSort({ stored: "name", hasHistory: false, isDesktop: false })).toBe("name");
  });

  it("a browser with history and nothing stored keeps the default", () => {
    expect(firstSort({ stored: null, hasHistory: true, isDesktop: true })).toBeNull();
  });

  it("a stored sort always wins", () => {
    expect(firstSort({ stored: "name", hasHistory: false, isDesktop: true })).toBe("name");
    expect(firstSort({ stored: "date", hasHistory: false, isDesktop: true })).toBe("date");
    expect(firstSort({ stored: "rated", hasHistory: true, isDesktop: true })).toBe("rated");
  });
});
