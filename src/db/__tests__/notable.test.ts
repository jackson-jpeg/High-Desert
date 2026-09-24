import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode } from "../schema";

/**
 * The curated notable list (Part 1C): `data/notable.json`, its cited table in
 * `data/notable.md`, `aiNotable: true` in the seed, and the refresh that brings
 * the flag to libraries seeded before it existed.
 *
 * The refresh writes to `db.episodes` unattended, so the assertions are on
 * what SURVIVES — every row, every field, compared whole — not only on the
 * nine rows it is meant to change.
 *
 * Real catalog, real Dexie, fake-indexeddb.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db, getPreference } = await import("../index");
const { refreshCatalogFlags, NOTABLE_HASHES, NOTABLE_VERSION } = await import("../catalog-flags");
const { toEpisodeRow } = await import("../seed");

const root = path.resolve(__dirname, "../../..");
const catalogJson = JSON.parse(fs.readFileSync(path.join(root, "public/seed/library.json"), "utf8"));
const catalogRows: Record<string, unknown>[] = Array.isArray(catalogJson) ? catalogJson : catalogJson.episodes;
const notableJson: { fileHash: string; airDate: string; title: string; why: string; source: { title: string; url: string } }[] =
  JSON.parse(fs.readFileSync(path.join(root, "data/notable.json"), "utf8"));
const notableMd = fs.readFileSync(path.join(root, "data/notable.md"), "utf8");

const SLOW = { timeout: 60_000 };

/** A library seeded before the flag existed: the catalog with `aiNotable` stripped, plus user data. */
async function seedPreFlagLibrary(): Promise<void> {
  const rows = catalogRows.map((r, i) => {
    const { aiNotable: _drop, ...rest } = r;
    void _drop;
    const row = { ...toEpisodeRow(rest, 1_000), lastPlayedAt: 0 } as Episode;
    // User data on some of the notable rows and some of the others.
    if (i % 7 === 0) row.favoritedAt = 5_000 + i;
    if (i % 11 === 0) row.rating = (i % 5) + 1;
    if (i % 13 === 0) row.playbackPosition = 600 + i;
    if (i % 17 === 0) row.playCount = i;
    return row;
  });
  // Put user data on every notable row explicitly.
  for (const r of rows) {
    if (NOTABLE_HASHES.includes(r.fileHash)) {
      r.favoritedAt = 9_999;
      r.rating = 4;
      r.playbackPosition = 1234;
      r.flaggedAt = 77;
    }
  }
  await db.episodes.bulkAdd(rows);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("the curated list: json, md and seed agree", () => {
  it("has entries, each with a cited source", () => {
    expect(notableJson.length).toBeGreaterThan(0);
    for (const e of notableJson) {
      expect(e.source.url, e.title).toMatch(/^https:\/\//);
      expect(e.why.length, e.title).toBeGreaterThan(20);
    }
  });

  it("every entry is a seed row whose air date matches, flagged in the seed", () => {
    const byHash = new Map(catalogRows.map((r) => [r.fileHash as string, r]));
    for (const e of notableJson) {
      const row = byHash.get(e.fileHash);
      expect(row, e.fileHash).toBeDefined();
      expect(row!.airDate, e.fileHash).toBe(e.airDate);
      expect(row!.aiNotable, e.fileHash).toBe(true);
    }
  });

  it("the seed flags exactly the listed rows — nothing else", () => {
    const flagged = catalogRows.filter((r) => r.aiNotable === true).map((r) => r.fileHash as string).sort();
    expect(flagged).toEqual([...NOTABLE_HASHES].sort());
  });

  it("the md table lists the same episodes with the same sources", () => {
    const tableRows = notableMd.split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l));
    expect(tableRows.length).toBe(notableJson.length);
    for (const e of notableJson) {
      const line = tableRows.find((l) => l.startsWith(`| ${e.airDate} | ${e.title} |`));
      expect(line, `${e.airDate} ${e.title}`).toBeDefined();
      expect(line, e.title).toContain(`(${e.source.url})`);
    }
  });

  it("toEpisodeRow keeps the flag (a seeded visitor gets it on day one)", () => {
    const flagged = catalogRows.find((r) => r.aiNotable === true)!;
    expect(toEpisodeRow(flagged, 1).aiNotable).toBe(true);
  });
});

describe("refreshCatalogFlags() on a library seeded before the list", () => {
  it("flags exactly the listed rows and every other field of every row survives", SLOW, async () => {
    await seedPreFlagLibrary();
    const before = new Map((await db.episodes.toArray()).map((r) => [r.id!, r]));
    expect([...before.values()].filter((r) => r.aiNotable).length).toBe(0);

    const changed = await refreshCatalogFlags();
    expect(changed).toBe(NOTABLE_HASHES.length);

    const after = await db.episodes.toArray();
    expect(after.length).toBe(before.size);
    for (const row of after) {
      const was = before.get(row.id!)!;
      if (NOTABLE_HASHES.includes(row.fileHash)) {
        expect(row.aiNotable, row.fileHash).toBe(true);
        const { aiNotable: _a, ...rest } = row;
        void _a;
        expect(rest, row.fileHash).toEqual(was);
      } else {
        expect(row, row.fileHash).toEqual(was);
      }
    }
    expect(await getPreference("catalog-notable")).toBe(NOTABLE_VERSION);
  });

  it("runs once per version: a second call writes nothing", SLOW, async () => {
    await seedPreFlagLibrary();
    await refreshCatalogFlags();
    // Unflag one by hand (an admin edit). The gate means it stays that way.
    const one = await db.episodes.where("fileHash").equals(NOTABLE_HASHES[0]).first();
    await db.episodes.update(one!.id!, { aiNotable: false });
    const snapshot = await db.episodes.toArray();

    expect(await refreshCatalogFlags()).toBe(0);
    expect(await db.episodes.toArray()).toEqual(snapshot);
  });

  it("never unsets a flag an admin set on an unlisted row", SLOW, async () => {
    await seedPreFlagLibrary();
    const other = await db.episodes.filter((r) => !NOTABLE_HASHES.includes(r.fileHash)).first();
    await db.episodes.update(other!.id!, { aiNotable: true });

    await refreshCatalogFlags();
    expect((await db.episodes.get(other!.id!))!.aiNotable).toBe(true);
    expect((await db.episodes.filter((r) => !!r.aiNotable).count())).toBe(NOTABLE_HASHES.length + 1);
  });

  it("adds no rows to a library missing some catalog episodes (reconcile's job, not this one's)", SLOW, async () => {
    await seedPreFlagLibrary();
    await db.episodes.where("fileHash").anyOf(NOTABLE_HASHES.slice(0, 3) as string[]).delete();
    const count = await db.episodes.count();

    expect(await refreshCatalogFlags()).toBe(NOTABLE_HASHES.length - 3);
    expect(await db.episodes.count()).toBe(count);
  });
});
