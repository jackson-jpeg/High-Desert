import { describe, it, expect } from "vitest";
import { endedEarly, EARLY_END_S } from "@/audio/ended-early";

const base = { currentTime: 10_000, elementDuration: 12_575, catalogDuration: 12_575, hasError: false };

describe("endedEarly", () => {
  it("the iOS shape — no error, 43 minutes short, element knows it is longer — is early", () => {
    expect(endedEarly(base)).toBe(true);
  });

  it("within two minutes of the catalogued end is a real end", () => {
    expect(endedEarly({ ...base, currentTime: 12_575 - EARLY_END_S })).toBe(false);
    expect(endedEarly({ ...base, currentTime: 12_575 - EARLY_END_S - 1 })).toBe(true);
  });

  it("an element error is the error path's business, not this one", () => {
    expect(endedEarly({ ...base, hasError: true })).toBe(false);
  });

  it("no catalogued duration, no verdict (archive.org's derive reports 0 for some)", () => {
    expect(endedEarly({ ...base, catalogDuration: 0 })).toBe(false);
    expect(endedEarly({ ...base, catalogDuration: null })).toBe(false);
  });

  it("a file the element says is over (shorter than catalogued) is not early", () => {
    expect(endedEarly({ ...base, elementDuration: 10_005 })).toBe(false);
  });

  it("an element with no usable duration defers to the catalog", () => {
    expect(endedEarly({ ...base, elementDuration: Infinity })).toBe(true);
    expect(endedEarly({ ...base, elementDuration: NaN })).toBe(true);
  });
});
