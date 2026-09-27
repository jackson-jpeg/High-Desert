// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileHashOf } from "../../e2e/fixture-audio";

/**
 * e2e/fixture-audio.ts sends archive.org's audio for an episode to
 * `/mirror/{fileHash}`. On the stack any hash plays; on production only the
 * right one does, so the hash is checked against every row of the real catalog.
 */

const catalog = JSON.parse(readFileSync(path.resolve(__dirname, "../../public/seed/library.json"), "utf8")) as
  | { sourceUrl?: string; fileHash?: string }[]
  | { episodes: { sourceUrl?: string; fileHash?: string }[] };
const rows = (Array.isArray(catalog) ? catalog : catalog.episodes).filter((r) => r.sourceUrl && r.fileHash);

describe("fileHashOf", () => {
  it("turns every catalog episode's archive.org URL back into its fileHash", () => {
    expect(rows.length).toBeGreaterThan(1000);
    const wrong = rows.filter((r) => fileHashOf(r.sourceUrl!) !== r.fileHash);
    expect(wrong.slice(0, 3)).toEqual([]);
  });

  it("is null for anything that is not an archive.org download", () => {
    expect(fileHashOf("https://archive.org/services/check")).toBeNull();
    expect(fileHashOf("https://example.com/download/a/b.mp3")).toBeNull();
    expect(fileHashOf("https://evilarchive.org/download/a/b.mp3")).toBeNull();
  });
});
