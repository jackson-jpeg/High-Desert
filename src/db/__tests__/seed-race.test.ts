import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Dexie from "dexie";
import { createFakeLockManager, installFakeLocks, type FakeLockManager } from "@/test-support/web-locks";

/**
 * HD-009: two first-visit tabs used to seed the whole catalog twice.
 *
 * Each "tab" here is a fresh module graph (`vi.resetModules()`), so it has its
 * own Dexie connection and its own per-tab `_seedPromise` guard — exactly what
 * a second browser tab has — while sharing one IndexedDB, as tabs of an origin
 * do. The two seeds are then started together and allowed to race.
 *
 * Two independent defences, each tested on its own:
 *   - the cross-tab lock (with a navigator.locks that queues like the real one);
 *   - the recount inside the write transaction (with navigator.locks absent,
 *     as on Safari < 15.4, and a fetch barrier that guarantees both tabs have
 *     passed the outer empty-check before either writes — the race, forced).
 *
 * Counts are asserted against the real catalog, never a literal.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const seedPath = path.resolve(__dirname, "../../../public/seed/library.json");
const catalogJson = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const catalogRows: Record<string, unknown>[] = Array.isArray(catalogJson) ? catalogJson : catalogJson.episodes;
const CATALOG_SIZE = new Set(catalogRows.map((r) => r.fileHash as string)).size;

type SeedModule = typeof import("../seed");
type DbModule = typeof import("../index");
interface Tab { seed: SeedModule; db: DbModule["db"] }

const opened: Tab[] = [];

async function openTab(): Promise<Tab> {
  vi.resetModules();
  const seed = await import("../seed");
  const { db } = await import("../index");
  const tab = { seed, db };
  opened.push(tab);
  return tab;
}

let fetchCalls = 0;

/** Serve the real catalog. With `barrier`, no fetch resolves until `barrier` calls have arrived. */
function serveCatalog(opts: { barrier?: number; delayMs?: number } = {}) {
  let waiting: (() => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      fetchCalls++;
      if (opts.barrier) {
        if (fetchCalls < opts.barrier) await new Promise<void>((r) => waiting.push(r));
        else { waiting.forEach((r) => r()); waiting = []; }
      }
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return { ok: true, json: () => Promise.resolve(catalogJson) } as Response;
    }),
  );
}

async function rowsAndDistinct(tab: Tab) {
  const all = await tab.db.episodes.toArray();
  return { rows: all.length, distinct: new Set(all.map((e) => e.fileHash)).size };
}

let uninstall: () => void = () => {};

beforeEach(async () => {
  fetchCalls = 0;
  await Dexie.delete("HighDesertDB");
});

afterEach(async () => {
  uninstall();
  uninstall = () => {};
  vi.unstubAllGlobals();
  for (const t of opened.splice(0)) t.db.close();
  await Dexie.delete("HighDesertDB");
});

// Each case bulk-writes the real 1,312-row catalog into fake-indexeddb, which
// takes seconds, not milliseconds — and longer under the full parallel suite.
const SLOW = { timeout: 60_000 };

describe("two tabs seeding at once — with navigator.locks", SLOW, () => {
  let locks: FakeLockManager;
  beforeEach(() => {
    locks = createFakeLockManager();
    uninstall = installFakeLocks(locks);
  });

  it("ends with exactly one row per catalog episode", async () => {
    serveCatalog({ delayMs: 20 });
    const a = await openTab();
    const b = await openTab();

    const results = await Promise.all([a.seed.seedLibraryIfEmpty(), b.seed.seedLibraryIfEmpty()]);

    expect(await rowsAndDistinct(a)).toEqual({ rows: CATALOG_SIZE, distinct: CATALOG_SIZE });
    // Exactly one tab seeded; the other found the library already there.
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("the waiting tab never fetches the catalog — it waited for the lock, then found rows", async () => {
    // What the lock adds over the in-transaction recount: the second tab does
    // not even look until the first has finished. Without the lock both tabs
    // download the catalog and the recount alone saves the data.
    serveCatalog({ delayMs: 20 });
    const a = await openTab();
    const b = await openTab();

    await Promise.all([a.seed.seedLibraryIfEmpty(), b.seed.seedLibraryIfEmpty()]);

    expect(fetchCalls).toBe(1);
    expect(locks.granted.filter((n) => n === "hd-seed")).toHaveLength(2);
  });
});

describe("two tabs seeding at once — navigator.locks unavailable", SLOW, () => {
  beforeEach(() => {
    uninstall = installFakeLocks(undefined);
  });

  it("the recount inside the write transaction still ends with one row per catalog episode", async () => {
    // The barrier holds both fetches until both tabs have asked, so both have
    // already seen an empty table outside the transaction: the race, forced.
    serveCatalog({ barrier: 2 });
    const a = await openTab();
    const b = await openTab();

    const results = await Promise.all([a.seed.seedLibraryIfEmpty(), b.seed.seedLibraryIfEmpty()]);

    expect(fetchCalls).toBe(2); // proves both tabs really did get past the outer check
    expect(await rowsAndDistinct(b)).toEqual({ rows: CATALOG_SIZE, distinct: CATALOG_SIZE });
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reconcile racing in two tabs restores each missing episode once", async () => {
    // Seed, then lose 25 rows the way the dedup bug did (no tombstones), and
    // clear the reconcile marker so both tabs go looking.
    serveCatalog();
    const a = await openTab();
    await a.seed.seedLibraryIfEmpty();
    const lost = (await a.db.episodes.limit(25).primaryKeys()) as number[];
    await a.db.episodes.bulkDelete(lost);
    await a.db.userPrefs.where("key").equals("seed-reconciled").delete();
    // A favourite on a survivor: reconcile must never touch an existing row.
    const survivor = (await a.db.episodes.toCollection().first())!;
    await a.db.episodes.update(survivor.id!, { favoritedAt: 1234 });

    fetchCalls = 0;
    serveCatalog({ barrier: 2 });
    const b = await openTab();
    const c = await openTab();
    const restored = await Promise.all([b.seed.reconcileLibrary(), c.seed.reconcileLibrary()]);

    expect(fetchCalls).toBe(2);
    expect(await rowsAndDistinct(b)).toEqual({ rows: CATALOG_SIZE, distinct: CATALOG_SIZE });
    expect(restored[0] + restored[1]).toBe(25);
    expect((await b.db.episodes.get(survivor.id!))!.favoritedAt).toBe(1234);
  });
});
