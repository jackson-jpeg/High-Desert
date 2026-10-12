import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { StoredEpisode } from "../schema";

/**
 * The categories given by hand to the 101 community shows on 2026-10-12
 * (`data/community-categories.json`, logged in `docs/community-sources.md`),
 * their place in the seed, and the refresh that brings them to libraries
 * seeded before they existed.
 *
 * The refresh writes to `db.episodes` unattended, so, like the notable test,
 * the assertions are on what SURVIVES: every row, every field, compared whole.
 *
 * Real catalog, real Dexie, fake-indexeddb.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db, getPreference } = await import("../index");
const { refreshCatalogCategories, COMMUNITY_CATEGORIES, CATEGORIES_VERSION } = await import("../catalog-flags");
const { toEpisodeRow } = await import("../seed");

const root = path.resolve(__dirname, "../../..");
const catalogRows: Record<string, unknown>[] = JSON.parse(
  fs.readFileSync(path.join(root, "public/seed/library.json"), "utf8"),
);
const listJson: { fileHash: string; airDate: string; title: string; category: string; why: string }[] = JSON.parse(
  fs.readFileSync(path.join(root, "data/community-categories.json"), "utf8"),
);
const logMd = fs.readFileSync(path.join(root, "docs/community-sources.md"), "utf8");
// The categorizer's own list: a hand assignment is held to the same vocabulary.
const py = fs.readFileSync(path.join(root, "scripts/categorize-library.py"), "utf8");
const CATEGORIES = [...py.match(/CATEGORIES = \[([\s\S]*?)\]/)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const SLOW = { timeout: 60_000 };
const LISTED = [...COMMUNITY_CATEGORIES.keys()];

/** A library seeded before the categories: the catalog with them stripped from the listed rows, plus user data. */
async function seedPreCategoryLibrary(): Promise<void> {
  const rows = catalogRows.map((r, i) => {
    const src = COMMUNITY_CATEGORIES.has(r.fileHash as string) ? { ...r, aiCategory: undefined } : r;
    const row = toEpisodeRow(src, 1_000) as StoredEpisode;
    if (i % 7 === 0) row.favoritedAt = 5_000 + i;
    if (i % 11 === 0) row.rating = (i % 5) + 1;
    if (i % 17 === 0) row.playCount = i;
    return row;
  });
  for (const r of rows) {
    if (COMMUNITY_CATEGORIES.has(r.fileHash)) {
      r.favoritedAt = 9_999;
      r.rating = 4;
      r.flaggedAt = 77;
    }
  }
  await db.episodes.bulkAdd(rows);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("the hand-assigned list: json, seed and log agree", () => {
  it("101 entries, each a category from the categorizer's list, each with a reason", () => {
    expect(listJson.length).toBe(101);
    for (const e of listJson) {
      expect(CATEGORIES, e.title).toContain(e.category);
      expect(e.why.length, e.title).toBeGreaterThan(3);
    }
  });

  it("the seed carries each listed category, and no seed row is left without one", () => {
    const byHash = new Map(catalogRows.map((r) => [r.fileHash as string, r]));
    for (const e of listJson) {
      const row = byHash.get(e.fileHash);
      expect(row, e.fileHash).toBeDefined();
      expect(row!.airDate, e.fileHash).toBe(e.airDate);
      expect(row!.aiCategory, e.fileHash).toBe(e.category);
    }
    expect(catalogRows.filter((r) => !r.aiCategory).map((r) => r.title)).toEqual([]);
  });

  it("the log in docs/community-sources.md lists every assignment", () => {
    const lines = logMd.split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l));
    for (const e of listJson) {
      const line = lines.find((l) => l.startsWith(`| ${e.airDate} | ${e.title} | ${e.category} |`));
      expect(line, `${e.airDate} ${e.title}`).toBeDefined();
    }
  });
});

describe("refreshCatalogCategories() on a library seeded before the categories", () => {
  it("categorizes exactly the listed rows and every other field of every row survives", SLOW, async () => {
    await seedPreCategoryLibrary();
    const before = new Map((await db.episodes.toArray()).map((r) => [r.id!, r]));
    expect([...before.values()].filter((r) => !r.aiCategory).length).toBe(LISTED.length);

    expect(await refreshCatalogCategories()).toBe(LISTED.length);

    const after = await db.episodes.toArray();
    expect(after.length).toBe(before.size);
    for (const row of after) {
      const was = before.get(row.id!)!;
      if (COMMUNITY_CATEGORIES.has(row.fileHash)) {
        expect(row.aiCategory, row.fileHash).toBe(COMMUNITY_CATEGORIES.get(row.fileHash));
        expect({ ...row, aiCategory: undefined }, row.fileHash).toEqual({ ...was, aiCategory: undefined });
      } else {
        expect(row, row.fileHash).toEqual(was);
      }
    }
    expect(await getPreference("catalog-categories")).toBe(CATEGORIES_VERSION);
  });

  it("a category already on a row (set by hand) is kept", SLOW, async () => {
    await seedPreCategoryLibrary();
    const one = await db.episodes.where("fileHash").equals(LISTED[0]).first();
    await db.episodes.update(one!.id!, { aiCategory: "Other" });
    expect(await refreshCatalogCategories()).toBe(LISTED.length - 1);
    expect((await db.episodes.get(one!.id!))!.aiCategory).toBe("Other");
  });

  it("runs once per version: a second call writes nothing", SLOW, async () => {
    await seedPreCategoryLibrary();
    await refreshCatalogCategories();
    const one = await db.episodes.where("fileHash").equals(LISTED[0]).first();
    await db.episodes.update(one!.id!, { aiCategory: undefined });
    expect(await refreshCatalogCategories()).toBe(0);
    expect((await db.episodes.get(one!.id!))!.aiCategory).toBeUndefined();
  });
});

describe("the layout runs the refresh", () => {
  // Mounting the layout needs the whole app; what matters is that the seed
  // chain calls it, after reconcile has added any missing rows.
  const layout = fs.readFileSync(path.join(root, "src/app/[look]/(desktop)/layout.tsx"), "utf8");
  it("calls refreshCatalogCategories() after reconcileLibrary(), as it does refreshCatalogFlags()", () => {
    const reconcile = layout.indexOf("await reconcileLibrary()");
    const flags = layout.indexOf("await refreshCatalogFlags()");
    const cats = layout.indexOf("await refreshCatalogCategories()");
    expect(reconcile).toBeGreaterThan(0);
    expect(flags).toBeGreaterThan(reconcile);
    expect(cats).toBeGreaterThan(reconcile);
  });
});
