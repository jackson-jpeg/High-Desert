// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REMOVED_FROM_CATALOG, isRemovedFromCatalog } from "@/lib/library/removed-episodes";

/**
 * The pulled-episode list is derived from docs/broken-episodes.md, which keeps
 * the full original record of every removal. The two must name the same rows,
 * none of them may be back in the catalog (a re-sourced show must stop being
 * marked), and nothing but the listed hash may match — above all not a local
 * file or an import that happens to share a name.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const doc = readFileSync(path.join(ROOT, "docs/broken-episodes.md"), "utf8");
const catalogRaw = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
const catalog: { fileHash: string }[] = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.episodes;

/** fileHash of every ```json record in the doc — the pulled rows, verbatim. */
const documented = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
  (m) => (JSON.parse(m[1]) as { fileHash: string }).fileHash,
);

describe("removed-episodes", () => {
  it("names exactly the rows docs/broken-episodes.md records as pulled", () => {
    expect(documented.length).toBeGreaterThan(0);
    expect([...REMOVED_FROM_CATALOG.keys()].sort()).toEqual([...documented].sort());
  });

  it("none of them is in the current catalog", () => {
    const hashes = new Set(catalog.map((r) => r.fileHash));
    for (const hash of REMOVED_FROM_CATALOG.keys()) expect(hashes.has(hash)).toBe(false);
  });

  it("marks the pulled row", () => {
    for (const fileHash of REMOVED_FROM_CATALOG.keys()) {
      expect(isRemovedFromCatalog({ fileHash })).toBe(true);
    }
  });

  it("does not mark a local file, or any catalog row, or a row with no hash", () => {
    const [pulled] = REMOVED_FROM_CATALOG.keys();
    const fileName = pulled.split(":").slice(2).join(":");
    // A scanned local copy of the same broadcast: its key is an MD5, not the archive key.
    expect(isRemovedFromCatalog({ fileHash: "5d41402abc4b2a76b9719d911017c592" })).toBe(false);
    // The same file name under a different item — someone's own import.
    expect(isRemovedFromCatalog({ fileHash: `archive:someone-elses-upload:${fileName}` })).toBe(false);
    expect(catalog.filter((r) => isRemovedFromCatalog(r))).toEqual([]);
    expect(isRemovedFromCatalog({ fileHash: "" })).toBe(false);
    expect(isRemovedFromCatalog(null)).toBe(false);
  });
});
