import "fake-indexeddb/auto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StoredEpisode } from "@/db/schema";

/**
 * The admin catalog export must write something the server can read, and
 * nothing of the admin's own (HD-025).
 *
 * The parser here is the **real** `src/services/stats/catalog.ts`, pointed at
 * a temporary `public/seed/library.json` holding the export's output — not a
 * restatement of the shape it expects, which would agree with the export by
 * construction (docs/disconnected-checks.md). The library it exports from is
 * the real seed, loaded into a real Dexie on fake-indexeddb, with the admin's
 * listening layered on top.
 */

// Seeding the real 1,312-row catalog into fake-indexeddb, several times per
// file, does not fit vitest's 5s default on a loaded machine — and a test that
// times out mid-transaction leaves writes landing in the next test's profile,
// so the first failure spreads. The budget is the machine's, not the code's.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db } = await import("@/db");
const { toEpisodeRow } = await import("@/db/seed");
const { buildCatalogExport } = await import("@/db/catalog-export");
const { communityKey } = await import("@/lib/utils/community-key");

const SEED_FILE = path.resolve(__dirname, "../../../public/seed/library.json");
const SEED = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as Record<string, unknown>[];

/** Every personal field an Episode can carry. None may appear in a catalog. */
const PERSONAL = ["favoritedAt", "rating", "flaggedAt", "playbackPosition", "lastPlayedAt", "playCount", "createdAt", "updatedAt", "scanSessionId", "id"];

let tmp: string;

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.episodes.clear(), db.playlists.clear(), db.userPrefs.clear()]);
  const now = Date.now();
  await db.episodes.bulkAdd(SEED.map((r) => toEpisodeRow(r, now)) as never);

  // The admin has been listening.
  const rows = await db.episodes.orderBy("id").limit(5).toArray();
  for (const [i, ep] of rows.entries()) {
    // playbackPosition / lastPlayedAt: the pre-v9 fields, which rows written
    // before the `progress` table (HD-016) still carry, frozen. They are
    // personal all the same and must not leak either.
    await db.episodes.update(ep.id!, {
      favoritedAt: now - i,
      rating: (i % 5) + 1,
      flaggedAt: i === 2 ? now : undefined,
      playbackPosition: 1234 + i,
      lastPlayedAt: now,
      playCount: 7,
    } as Partial<StoredEpisode>);
  }
  // And scanned a file off their own disk.
  await db.episodes.add({
    fileHash: "d41d8cd98f00b204e9800998ecf8427e",
    filePath: "/Users/admin/Music/private-rip.mp3",
    fileName: "private-rip.mp3",
    fileSize: 1,
    source: "local",
    title: "Private rip",
    createdAt: now,
    updatedAt: now,
  });
  await db.playlists.add({ name: "Admin's late nights", episodeIds: [rows[0].id!], createdAt: now, updatedAt: now });

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hd-catalog-"));
  fs.mkdirSync(path.join(tmp, "public", "seed"), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function parseWithServer(json: string) {
  fs.writeFileSync(path.join(tmp, "public", "seed", "library.json"), json);
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.resetModules();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { catalog } = await import("@/services/stats/catalog");
  const map = await catalog();
  return { map, loadErrors: errors.mock.calls.length };
}

describe("admin catalog export", () => {
  it("is parsed by the real server catalog, every episode resolved", async () => {
    const json = JSON.stringify(buildCatalogExport(await db.episodes.toArray()));
    const { map, loadErrors } = await parseWithServer(json);

    expect(loadErrors).toBe(0);
    expect(map.size).toBe(SEED.length);
    for (const row of SEED) {
      const entry = map.get(communityKey(row as { archiveIdentifier: string; fileName: string })!);
      expect(entry?.title).toBe(row.title);
    }
  });

  it("carries none of the admin's personal fields, local files or playlists", async () => {
    const rows = buildCatalogExport(await db.episodes.toArray());
    const json = JSON.stringify(rows);
    for (const field of PERSONAL) {
      expect(json, `${field} leaked into the catalog`).not.toContain(`"${field}"`);
    }
    expect(json).not.toContain("private-rip");
    expect(json).not.toContain("/Users/admin");
    expect(json).not.toContain("late nights");
    expect(Array.isArray(rows)).toBe(true);
  });

  it("round-trips the shipped catalog exactly — nothing catalog-worthy is dropped either", async () => {
    // The personal fields stripped, the rest must be exactly the shipped file:
    // an allowlist that forgot a field would show up here, not in production.
    const rows = buildCatalogExport(await db.episodes.orderBy("id").toArray());
    expect(rows).toEqual(SEED);
  });

  it("a fresh visitor seeded from it starts with no favourites or ratings", async () => {
    const rows = buildCatalogExport(await db.episodes.toArray()) as Record<string, unknown>[];
    const seeded = rows.map((r) => toEpisodeRow(r, 0));
    expect(seeded.filter((e) => e.favoritedAt !== undefined || e.rating !== undefined)).toEqual([]);
  });
});
