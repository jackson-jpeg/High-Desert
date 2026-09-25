import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MUTATIONS } from "../mutate-check.mjs";

/**
 * The mutation list is an array of object literals, and JavaScript accepts a
 * duplicate key without complaint. On 2026-09-25 a merge left one entry
 * without its closing `},`, so the next entry's keys landed in the same
 * object and overwrote it: `ended-early-element-guard` silently stopped being
 * checked, and the script, CI and the syntax check all stayed green.
 *
 * So the source is held to the runtime list: every `id:` written in the file
 * must be a distinct entry the script will actually run.
 */
const SRC = readFileSync(path.resolve(import.meta.dirname, "../mutate-check.mjs"), "utf8");

describe("scripts/mutate-check.mjs", () => {
  it("every id written in the source is its own entry at runtime", () => {
    const written = [...SRC.matchAll(/^\s+id: "([^"]+)",$/gm)].map((m) => m[1]);
    const running = MUTATIONS.map((m: { id: string }) => m.id);
    expect(written.length).toBeGreaterThan(100);
    expect(running).toEqual(written);
  });

  it("ids are unique", () => {
    const ids = MUTATIONS.map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has the fields the runner needs", () => {
    for (const m of MUTATIONS as Array<Record<string, unknown>>) {
      for (const k of ["id", "test", "file", "find", "replace", "why"]) {
        expect(typeof m[k], `${String(m.id)}.${k}`).toBe("string");
      }
    }
  });
});
