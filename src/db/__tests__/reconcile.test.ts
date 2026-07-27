import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planReconcile, seedFileHash, toEpisodeRow } from "../seed";

/**
 * reconcileLibrary() restores catalog episodes deleted by the dedup bug.
 *
 * The safety property that matters: it must NEVER emit a row whose fileHash
 * already exists locally, because the caller bulkAdd()s the result. If it did,
 * it would duplicate rows and (worse) imply overwriting user state.
 */

const seedPath = path.resolve(__dirname, "../../../public/seed/library.json");
const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const seedRows: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.episodes;

const allHashes = seedRows.map(seedFileHash);

describe("seedFileHash", () => {
  it("is unique across the whole catalog", () => {
    expect(new Set(allHashes).size).toBe(seedRows.length);
  });

  it("is non-empty for every row", () => {
    expect(allHashes.every((h) => typeof h === "string" && h.length > 0)).toBe(true);
  });
});

describe("planReconcile", () => {
  it("restores nothing when the library is complete", () => {
    const local = new Set(allHashes);
    expect(planReconcile(seedRows, local, new Set())).toHaveLength(0);
  });

  it("restores the missing remainder after a near-total wipe", () => {
    // Reproduce the incident: one survivor out of the whole catalog.
    const survivor = allHashes[0];
    const local = new Set([survivor]);
    const missing = planReconcile(seedRows, local, new Set());
    expect(missing).toHaveLength(seedRows.length - 1);
  });

  it("NEVER returns a row that already exists locally", () => {
    // Every third episode survives.
    const local = new Set(allHashes.filter((_, i) => i % 3 === 0));
    const missing = planReconcile(seedRows, local, new Set());

    for (const row of missing) {
      expect(local.has(seedFileHash(row))).toBe(false);
    }
    expect(missing).toHaveLength(seedRows.length - local.size);
  });

  it("respects tombstones so deliberate deletions stay deleted", () => {
    const deleted = allHashes.slice(0, 5);
    const local = new Set(allHashes.slice(5));
    const missing = planReconcile(seedRows, local, new Set(deleted));
    expect(missing).toHaveLength(0);
  });

  it("restores only the non-tombstoned missing rows", () => {
    const local = new Set(allHashes.slice(10));
    const tombstones = new Set(allHashes.slice(0, 4));
    const missing = planReconcile(seedRows, local, tombstones);
    expect(missing).toHaveLength(6);
    expect(missing.every((r) => !tombstones.has(seedFileHash(r)))).toBe(true);
  });

  it("handles a totally empty local set", () => {
    expect(planReconcile(seedRows, new Set(), new Set())).toHaveLength(seedRows.length);
  });
});

describe("toEpisodeRow", () => {
  it("preserves the identity key and carries no user state", () => {
    const row = toEpisodeRow(seedRows[0], 1234);
    expect(row.fileHash).toBe(seedFileHash(seedRows[0]));
    expect(row.createdAt).toBe(1234);
    // Restored rows must not invent playback state
    expect(row.playCount).toBeUndefined();
    expect(row.playbackPosition).toBeUndefined();
    expect(row.lastPlayedAt).toBeUndefined();
  });

  it("maps every catalog row without throwing", () => {
    expect(() => seedRows.map((r) => toEpisodeRow(r, 0))).not.toThrow();
  });
});
