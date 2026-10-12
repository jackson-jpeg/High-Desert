import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ARRIVAL_SOURCES, PLAY_SURFACES, USAGE_DEVICES, USAGE_ROUTES, routeOf } from "../vocab";

/**
 * The tab a pathname counts as, and the vocabulary held equal to the CHECK
 * constraints in scripts/schema.sql: a value the browser can send that the
 * table refuses would be a 503 on every such view, or a play stored without
 * its surface.
 */

describe("routeOf", () => {
  it.each([
    ["/", "welcome"],
    ["", "welcome"],
    ["/library", "library"],
    ["/library/", "library"],
    ["/radio", "radio"],
    ["/stats", "stats"],
    ["/live", "live"],
    ["/show/1997-06-18-coast", "show"],
    ["/scanner", "other"],
    ["/search", "other"],
    ["/look", "other"],
    ["/libraryx", "other"],
  ])("%s is %s", (pathname, want) => {
    expect(routeOf(pathname)).toBe(want);
  });
});

const schema = readFileSync(path.resolve(__dirname, "../../../../scripts/schema.sql"), "utf8");

/** The quoted values of the first `CHECK (<column> IN (...))` after `anchor`. */
function checkList(anchor: string, column: string): string[] {
  const from = schema.indexOf(anchor);
  expect(from).toBeGreaterThan(-1);
  const m = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`).exec(schema.slice(from));
  expect(m).not.toBeNull();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("the vocabulary is the schema's", () => {
  it("route_daily", () => {
    expect(checkList("CREATE TABLE IF NOT EXISTS route_daily", "route")).toEqual([...USAGE_ROUTES]);
    expect(checkList("CREATE TABLE IF NOT EXISTS route_daily", "device")).toEqual([...USAGE_DEVICES]);
  });

  it("arrival_daily", () => {
    expect(checkList("CREATE TABLE IF NOT EXISTS arrival_daily", "source")).toEqual([...ARRIVAL_SOURCES]);
    expect(checkList("CREATE TABLE IF NOT EXISTS arrival_daily", "landing")).toEqual([...USAGE_ROUTES]);
  });

  it("play_events.surface", () => {
    expect(checkList("ADD COLUMN IF NOT EXISTS surface", "surface")).toEqual([...PLAY_SURFACES]);
  });
});
