import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ArchiveItem } from "../types";

/**
 * The catalog scraper's import loop, against a real database (HD-025).
 *
 *   - Identity: rows are keyed `archive:{identifier}:{fileName}`, exactly like
 *     the seeder and collection import — not the file-less `archive:{identifier}`
 *     it used to write.
 *   - Resume tracks IMPORT progress. Interrupt after N imports; the resumed run
 *     must import exactly the rest — nothing skipped, nothing twice. The saved
 *     page used to advance during collection, so a resume skipped every page
 *     collected before the interruption but never imported.
 *
 * Only the network is faked: the scrape route (via fetch) and item metadata.
 */

const getArchiveItem = vi.fn<(id: string) => Promise<ArchiveItem>>();
vi.mock("@/services/archive/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../client")>();
  return { ...real, getArchiveItem: (id: string) => getArchiveItem(id) };
});

const { db } = await import("@/db");
const { runCatalogImport, RESUME_PREF } = await import("../catalog-import");

const PAGES = [
  ["coast-1995-01-01", "coast-1995-01-02", "coast-1995-01-03"],
  ["coast-1995-02-01", "coast-1995-02-02", "coast-1995-02-03"],
  ["coast-1995-03-01", "coast-1995-03-02", "coast-1995-03-03"],
];
const ALL = PAGES.flat();
const fileOf = (id: string) => `${id} Art Bell.mp3`;

let pagesFetched: number[] = [];

function serveScrape() {
  pagesFetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const page = Number(new URL(url, "http://x").searchParams.get("page"));
      pagesFetched.push(page);
      const items = (PAGES[page - 1] ?? []).map((identifier) => ({ identifier, title: identifier }));
      return {
        ok: true,
        json: async () => ({ items, page, totalPages: PAGES.length, total: ALL.length }),
      } as Response;
    }),
  );
}

function sink(onImported?: (n: number) => void) {
  return {
    updateProgress: (u: { imported?: number }) => { if (u.imported !== undefined) onImported?.(u.imported); },
    setPhase: vi.fn(),
    setCurrentItem: vi.fn(),
    addError: vi.fn(),
  };
}

const FAST = { pageDelayMs: 0, itemDelayMs: 0 };

beforeEach(async () => {
  vi.unstubAllGlobals();
  getArchiveItem.mockReset();
  getArchiveItem.mockImplementation(async (identifier) => ({
    identifier,
    metadata: { title: `Title ${identifier}`, date: "1995-01-01" },
    files: [{ name: fileOf(identifier), format: "VBR MP3", source: "original", size: "100" }],
  }));
  if (!db.isOpen()) await db.open();
  await Promise.all([db.episodes.clear(), db.userPrefs.clear()]);
  serveScrape();
});

describe("runCatalogImport — identity", () => {
  it("keys every row archive:{identifier}:{fileName}, like the seeder and collection import", async () => {
    await runCatalogImport(new AbortController().signal, sink(), FAST);
    const rows = await db.episodes.toArray();
    expect(rows.map((r) => r.fileHash).sort()).toEqual(
      ALL.map((id) => `archive:${id}:${fileOf(id)}`).sort(),
    );
  });

  it("recognises a file already imported by another path and does not add it again", async () => {
    // The same file, arrived through collection import with the canonical key.
    const id = ALL[4];
    await db.episodes.add({
      fileHash: `archive:${id}:${fileOf(id)}`, filePath: "", fileName: fileOf(id), fileSize: 0,
      archiveIdentifier: id, favoritedAt: 5, createdAt: 0, updatedAt: 0,
    });
    const res = await runCatalogImport(new AbortController().signal, sink(), FAST);
    expect(res.imported).toBe(ALL.length - 1);
    expect(await db.episodes.count()).toBe(ALL.length);
    expect((await db.episodes.where("fileHash").equals(`archive:${id}:${fileOf(id)}`).toArray())).toHaveLength(1);
  });
});

describe("runCatalogImport — resume", () => {
  it("interrupted after N imports, a resume imports exactly the rest", async () => {
    const N = 4; // mid page 2
    const first = new AbortController();
    const r1 = await runCatalogImport(first.signal, sink((n) => { if (n === N) first.abort(); }), FAST);
    expect(r1).toMatchObject({ outcome: "cancelled", imported: N });
    expect(await db.episodes.count()).toBe(N);

    getArchiveItem.mockClear();
    serveScrape();
    const r2 = await runCatalogImport(new AbortController().signal, sink(), { ...FAST, resume: true });

    expect(r2).toMatchObject({ outcome: "done", imported: ALL.length - N });
    const hashes = (await db.episodes.toArray()).map((r) => r.fileHash);
    expect(hashes).toHaveLength(ALL.length);
    expect(new Set(hashes).size).toBe(ALL.length);
    expect(new Set(hashes)).toEqual(new Set(ALL.map((id) => `archive:${id}:${fileOf(id)}`)));

    // It resumed at the first page not fully imported — page 1 was done and
    // is not fetched again; page 2 is, and its one imported item is skipped
    // without a metadata request.
    expect(pagesFetched).toEqual([2, 3]);
    expect(getArchiveItem.mock.calls.map(([id]) => id)).toEqual(ALL.slice(N));
  });

  it("clears its progress once the whole catalog is imported", async () => {
    await runCatalogImport(new AbortController().signal, sink(), FAST);
    expect((await db.userPrefs.where("key").equals(RESUME_PREF).first())?.value).toBe("");
  });
});
