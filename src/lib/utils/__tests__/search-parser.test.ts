import { describe, it, expect } from "vitest";
import { parseSearch, hasOperators } from "../search-parser";

describe("parseSearch", () => {
  it("extracts guest operator", () => {
    const result = parseSearch("guest:hoagland");
    expect(result.guest).toBe("hoagland");
    expect(result.text).toBe("");
  });

  it("extracts year operator", () => {
    const result = parseSearch("year:1997");
    expect(result.year).toBe("1997");
  });

  it("extracts tag operator", () => {
    const result = parseSearch("tag:ufo");
    expect(result.tag).toBe("ufo");
  });

  it("extracts show operator", () => {
    const result = parseSearch("show:coast");
    expect(result.show).toBe("coast");
  });

  it("extracts cat operator", () => {
    const result = parseSearch("cat:paranormal");
    expect(result.cat).toBe("paranormal");
  });

  it("extracts series operator", () => {
    const result = parseSearch("series:mel");
    expect(result.series).toBe("mel");
  });

  it("extracts single has operator", () => {
    const result = parseSearch("has:favorite");
    expect(result.has).toEqual(["favorite"]);
  });

  it("extracts multiple has operators", () => {
    const result = parseSearch("has:favorite has:bookmark");
    expect(result.has).toEqual(["favorite", "bookmark"]);
  });

  it("extracts free-text after operators", () => {
    const result = parseSearch("guest:hoagland mars anomalies");
    expect(result.guest).toBe("hoagland");
    expect(result.text).toBe("mars anomalies");
  });

  it("handles free-text only", () => {
    const result = parseSearch("area 51");
    expect(result.text).toBe("area 51");
    expect(result.guest).toBeUndefined();
    expect(result.has).toEqual([]);
  });

  it("is case insensitive for operator names", () => {
    const result = parseSearch("Guest:Hoagland YEAR:1997");
    expect(result.guest).toBe("hoagland");
    expect(result.year).toBe("1997");
  });

  it("handles empty input", () => {
    const result = parseSearch("");
    expect(result.text).toBe("");
    expect(result.has).toEqual([]);
  });

  it("extracts duration operator", () => {
    const result = parseSearch("duration:>60");
    expect(result.duration).toEqual({ op: ">", value: 60 });
  });

  it("extracts duration with >= operator", () => {
    const result = parseSearch("duration:>=120");
    expect(result.duration).toEqual({ op: ">=", value: 120 });
  });

  it("extracts duration with < operator", () => {
    const result = parseSearch("duration:<30");
    expect(result.duration).toEqual({ op: "<", value: 30 });
  });

  it("extracts rating operator", () => {
    const result = parseSearch("rating:>=4");
    expect(result.rating).toEqual({ op: ">=", value: 4 });
  });

  it("extracts rating with exact value", () => {
    const result = parseSearch("rating:5");
    expect(result.rating).toEqual({ op: "=", value: 5 });
  });

  it("extracts favorited operator", () => {
    const result = parseSearch("favorited:true");
    expect(result.favorited).toBe(true);
  });

  it("combines multiple new operators with text", () => {
    const result = parseSearch("duration:>60 rating:>=4 ufo");
    expect(result.duration).toEqual({ op: ">", value: 60 });
    expect(result.rating).toEqual({ op: ">=", value: 4 });
    expect(result.text).toBe("ufo");
  });
});

describe("hasOperators", () => {
  it("returns true for operator strings", () => {
    expect(hasOperators("guest:foo")).toBe(true);
    expect(hasOperators("has:favorite")).toBe(true);
    expect(hasOperators("duration:>60")).toBe(true);
    expect(hasOperators("rating:5")).toBe(true);
    expect(hasOperators("favorited:true")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(hasOperators("area 51")).toBe(false);
    expect(hasOperators("")).toBe(false);
  });
});
