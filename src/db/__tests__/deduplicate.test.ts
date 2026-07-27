import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dedupKey, planDeduplication, validatePlan } from "../deduplicate";
import type { Episode } from "../schema";

/**
 * Regression tests for the library-wipe incident.
 *
 * Every episode in the shipped catalog shares the archiveIdentifier
 * "ultimate-ultimate-art-bell-collection". The old dedupKey() keyed on that alone,
 * collapsing all 1,313 episodes into one group and deleting 1,312 of them.
 */

const seedPath = path.resolve(__dirname, "../../../public/seed/library.json");
const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const seedRows: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.episodes;

/** Map a seed row to an Episode the way src/db/seed.ts does. */
function toEpisode(row: Record<string, unknown>, id: number): Episode {
  return {
    id,
    fileHash: (row.fileHash as string) ?? `archive:${row.archiveIdentifier ?? row.fileName}`,
    filePath: (row.filePath as string) ?? "",
    fileName: (row.fileName as string) ?? "",
    fileSize: (row.fileSize as number) ?? 0,
    title: row.title as string | undefined,
    airDate: row.airDate as string | undefined,
    guestName: row.guestName as string | undefined,
    showType: row.showType as Episode["showType"],
    archiveIdentifier: row.archiveIdentifier as string | undefined,
    aiStatus: (row.aiStatus as Episode["aiStatus"]) ?? "completed",
    source: "archive",
    createdAt: 0,
    updatedAt: 0,
  } as Episode;
}

const catalog = seedRows.map(toEpisode);

describe("seed catalog fixture", () => {
  it("is the real shipped catalog", () => {
    expect(catalog.length).toBeGreaterThan(1000);
  });

  it("has a single shared archiveIdentifier — the condition that caused the wipe", () => {
    const identifiers = new Set(catalog.map((e) => e.archiveIdentifier));
    expect(identifiers.size).toBe(1);
  });
});

describe("dedupKey", () => {
  it("produces a distinct key for every episode in the catalog", () => {
    const keys = new Set(catalog.map(dedupKey));
    expect(keys.size).toBe(catalog.length);
  });

  it("does not collapse two files from the same collection", () => {
    const a = { archiveIdentifier: "coll", fileName: "one.mp3" } as Episode;
    const b = { archiveIdentifier: "coll", fileName: "two.mp3" } as Episode;
    expect(dedupKey(a)).not.toBe(dedupKey(b));
  });

  it("treats the legacy 'identifier/file.mp3' shape as the same identity", () => {
    const modern = { archiveIdentifier: "coll", fileName: "one.mp3" } as Episode;
    const legacy = { archiveIdentifier: "coll/one.mp3", fileName: "" } as Episode;
    expect(dedupKey(legacy)).toBe(dedupKey(modern));
  });

  it("falls back to fileHash when there is no archiveIdentifier", () => {
    const ep = { fileHash: "abc123", fileName: "x.mp3" } as Episode;
    expect(dedupKey(ep)).toBe("hash:abc123");
  });
});

describe("planDeduplication", () => {
  it("removes nothing from the real catalog", () => {
    const plan = planDeduplication(catalog);
    expect(plan.duplicatesToRemove).toBe(0);
    expect(plan.groups).toHaveLength(0);
    expect(plan.largestGroup).toBe(1);
  });

  it("still merges genuine duplicates", () => {
    const dupes = [
      { id: 1, archiveIdentifier: "coll", fileName: "a.mp3", playCount: 2 },
      { id: 2, archiveIdentifier: "coll", fileName: "a.mp3", playCount: 3, favoritedAt: 99 },
      { id: 3, archiveIdentifier: "coll", fileName: "b.mp3" },
    ] as Episode[];
    const plan = planDeduplication(dupes);
    expect(plan.duplicatesToRemove).toBe(1);
    expect(plan.groups).toHaveLength(1);
    // Play counts are summed and the favorite is preserved
    expect(plan.groups[0].update.playCount).toBe(5);
    expect(plan.groups[0].update.favoritedAt).toBe(99);
  });
});

describe("validatePlan safety rails", () => {
  it("accepts the real catalog", () => {
    expect(validatePlan(planDeduplication(catalog)).ok).toBe(true);
  });

  it("refuses a plan that would delete the whole catalog", () => {
    // Reproduce the incident: force every episode into one group.
    const collapsed = catalog.map((e) => ({ ...e, archiveIdentifier: undefined, fileHash: undefined }));
    for (const e of collapsed) {
      e.title = "same title";
      e.airDate = "1997-04-07";
    }
    const plan = planDeduplication(collapsed as unknown as Episode[]);
    expect(plan.duplicatesToRemove).toBe(catalog.length - 1);

    const check = validatePlan(plan);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/Refusing to deduplicate/);
  });

  it("refuses an oversized group", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      archiveIdentifier: "coll",
      fileName: "same.mp3",
    })) as Episode[];
    const check = validatePlan(planDeduplication(many));
    expect(check.ok).toBe(false);
  });

  it("refuses when more than 25% would be deleted", () => {
    // 10 identical + 20 unique = 9 deletions of 30 = 30%
    const eps = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, archiveIdentifier: "c", fileName: "dup.mp3" })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, archiveIdentifier: "c", fileName: `u${i}.mp3` })),
    ] as Episode[];
    const plan = planDeduplication(eps);
    expect(plan.duplicatesToRemove).toBe(9);
    expect(validatePlan(plan).ok).toBe(false);
  });

  it("allows a small, plausible duplicate set", () => {
    const eps = [
      ...Array.from({ length: 2 }, (_, i) => ({ id: i + 1, archiveIdentifier: "c", fileName: "dup.mp3" })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, archiveIdentifier: "c", fileName: `u${i}.mp3` })),
    ] as Episode[];
    expect(validatePlan(planDeduplication(eps)).ok).toBe(true);
  });
});
