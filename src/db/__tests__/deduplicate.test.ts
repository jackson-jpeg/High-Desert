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

  it("carries the most recently played copy's progress onto the keeper's hash (HD-016)", () => {
    const dupes = [
      { id: 1, fileHash: "archive:coll:a.mp3", archiveIdentifier: "coll", fileName: "a.mp3", title: "A", airDate: "1997-01-01" },
      { id: 2, fileHash: "archive:coll", archiveIdentifier: "coll", fileName: "a.mp3" },
    ] as Episode[];
    const progress = new Map([
      ["archive:coll:a.mp3", { fileHash: "archive:coll:a.mp3", playbackPosition: 100, lastPlayedAt: 10 }],
      ["archive:coll", { fileHash: "archive:coll", playbackPosition: 900, lastPlayedAt: 20 }],
    ]);
    const plan = planDeduplication(dupes, progress);
    expect(plan.groups[0].keeper.id).toBe(1);
    expect(plan.groups[0].progress).toEqual({ fileHash: "archive:coll:a.mp3", playbackPosition: 900, lastPlayedAt: 20 });
    // The episode row's update carries no position: it is not stored there.
    expect(plan.groups[0].update).not.toHaveProperty("playbackPosition");
    expect(plan.groups[0].update).not.toHaveProperty("lastPlayedAt");
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

  // The two rails are independent, and this test has to isolate the first one.
  // It used to be 25 rows that were *all* duplicates — a 96% deletion, which the
  // ratio rail refuses as well, so the test passed just as happily with the
  // group-size check removed (the `dedup-rail-group-size` mutation came back
  // GREEN in CI). Padding with uniques puts the deletion at 11%, inside the
  // ratio rail, so nothing but the group size can refuse this plan.
  it("refuses an oversized group, on the group size alone", () => {
    const eps = [
      ...Array.from({ length: 25 }, (_, i) => ({ id: i + 1, archiveIdentifier: "coll", fileName: "same.mp3" })),
      ...Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, archiveIdentifier: "coll", fileName: `u${i}.mp3` })),
    ] as Episode[];
    const plan = planDeduplication(eps);
    expect(plan.duplicatesToRemove).toBe(24);
    // Control: this plan is well inside the ratio rail, so that cannot be what refuses it.
    expect(plan.duplicatesToRemove / plan.totalBefore).toBeLessThan(0.25);

    const check = validatePlan(plan);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/identical episodes/);
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
