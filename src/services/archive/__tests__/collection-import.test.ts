import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ArchiveFile } from "../types";

/**
 * Collection import's loop, against a real database (HD-015).
 *
 * This is the *other* import path: one archive.org item, many audio files, each
 * becoming an episode. It shares nothing with the catalog scraper but the
 * identity key, and until this file it had no test at all — it lived inside
 * `useCollectionImport` where the loop could not be reached without a renderer.
 *
 * The assertions are written on what SURVIVES a run rather than on what the
 * loop did, because the failures that matter here are all losses:
 *
 *   - Identity: rows are keyed `archive:{identifier}:{fileName}`. The control
 *     is that the collection id is the SAME for every file, so a row keyed on
 *     it alone would have collapsed the whole collection to one episode — the
 *     shape of the wipe incident (see "Data safety" in CLAUDE.md).
 *   - A file the listener already has keeps their favourite, rating and play
 *     count. Re-importing a collection must not touch what is already there,
 *     and the control is that a genuinely new file in the same collection is
 *     still imported — otherwise "nothing was overwritten" would pass just as
 *     well for a run that did nothing at all.
 *   - One unreadable file costs that file only. Import is long and
 *     user-initiated; aborting the whole collection on one bad row means
 *     starting over.
 *   - Cancelling keeps what was already imported. The listener asked to stop,
 *     not to undo.
 *
 * Nothing is faked but the abort clock: the database is real (fake-indexeddb),
 * and so are the identity, dedup and filename-parsing paths.
 */

const { db } = await import("@/db");
const { runCollectionImport } = await import("../collection-import");
const { archiveFileHash } = await import("@/db/identity");

const COLLECTION = "ultimate-art-bell-collection";

/**
 * Three filenames in the catalog's real shape — date first, then the show —
 * which is what `parseArtBellFilename` reads. An invented "Art Bell - … - date"
 * shape parses to nothing, and the air-date assertion below caught exactly that.
 */
const FILES: ArchiveFile[] = [
  { name: "1997-04-07 - Coast to Coast AM with Art Bell - Heaven's Gate - Courtney Brown.mp3", format: "VBR MP3", size: "100", length: "3600" },
  { name: "1997-04-08 - Coast to Coast AM with Art Bell - Area 51 - John Lear.mp3", format: "VBR MP3", size: "200", length: "3700" },
  { name: "1997-04-09 - Coast to Coast AM with Art Bell - Remote Viewing - Ed Dames.mp3", format: "VBR MP3", size: "300", length: "3800" },
];

const info = { identifier: COLLECTION, title: "The collection", description: "", creator: "Art Bell", audioFiles: FILES };

function sink(onFile?: (name: string | null) => void) {
  return {
    updateProgress: vi.fn(),
    setPhase: vi.fn(),
    setCurrentFile: (name: string | null) => onFile?.(name),
    addError: vi.fn(),
  };
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.episodes.clear();
});

describe("runCollectionImport — identity", () => {
  it("keys every row archive:{identifier}:{fileName}, never on the collection id", async () => {
    const result = await runCollectionImport(new AbortController().signal, info, sink());
    expect(result).toMatchObject({ outcome: "done", imported: 3, duplicates: 0 });

    const rows = await db.episodes.toArray();
    expect(rows.map((r) => r.fileHash).sort()).toEqual(
      FILES.map((f) => archiveFileHash(COLLECTION, f.name)).sort(),
    );

    // The control for that key: every one of these files carries the SAME
    // archiveIdentifier, so it cannot be an identity — three files, one id.
    expect(new Set(rows.map((r) => r.archiveIdentifier))).toEqual(new Set([COLLECTION]));
    expect(rows).toHaveLength(3);
  });

  it("stores what the filename parser found, and falls back to the name when it finds nothing", async () => {
    // Which segment the parser calls the guest is its own business
    // (filename-parser.test.ts); what belongs here is that collection import
    // runs it and keeps the result rather than storing a raw filename.
    const unparseable = { name: "track03.mp3", format: "VBR MP3", size: "400" };
    await runCollectionImport(
      new AbortController().signal,
      { ...info, audioFiles: [...FILES, unparseable] },
      sink(),
    );

    const parsed = await db.episodes.where("fileHash").equals(archiveFileHash(COLLECTION, FILES[0].name)).first();
    expect(parsed?.airDate).toBe("1997-04-07");
    expect(parsed?.showType).toBe("coast");
    expect(parsed?.title).toContain("Coast to Coast AM");
    expect(parsed?.duration).toBe(3600);
    expect(parsed?.source).toBe("archive");

    const raw = await db.episodes.where("fileHash").equals(archiveFileHash(COLLECTION, unparseable.name)).first();
    expect(raw?.title).toBe("track03");
    expect(raw?.airDate).toBeUndefined();
  });
});

describe("runCollectionImport — a file already in the library", () => {
  it("leaves the listener's favourite, rating and play count exactly as they were", async () => {
    const kept = {
      fileHash: archiveFileHash(COLLECTION, FILES[1].name),
      filePath: "opfs://mine",
      fileName: FILES[1].name,
      fileSize: 999,
      title: "My own title",
      archiveIdentifier: COLLECTION,
      favoritedAt: 1_700_000_000_000,
      rating: 5,
      playCount: 12,
      playbackPosition: 1234,
      source: "archive" as const,
      aiStatus: "completed" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const id = await db.episodes.add(kept as never);

    const result = await runCollectionImport(new AbortController().signal, info, sink());
    expect(result).toMatchObject({ outcome: "done", imported: 2, duplicates: 1 });

    // Untouched, byte for byte, and still the only row for that file.
    const after = await db.episodes.where("fileHash").equals(kept.fileHash).toArray();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id, ...kept });

    // Control: the run was not simply a no-op — the other two files landed.
    expect(await db.episodes.count()).toBe(3);
  });

  it("recognises a row written the legacy way, with the file name folded into the identifier", async () => {
    // Before `archiveFileHash` existed, the scraper wrote `archive:{identifier}`
    // with the file in archiveIdentifier. findDuplicateEpisode's fallback arm
    // must still see it, or a re-import duplicates every such row.
    await db.episodes.add({
      fileHash: `archive:${COLLECTION}`,
      filePath: "x",
      fileName: FILES[2].name,
      fileSize: 0,
      archiveIdentifier: `${COLLECTION}/${FILES[2].name}`,
      rating: 3,
      source: "archive",
      aiStatus: "completed",
      createdAt: 1,
      updatedAt: 1,
    } as never);

    const result = await runCollectionImport(new AbortController().signal, info, sink());
    expect(result.duplicates).toBe(1);

    const forThatFile = (await db.episodes.toArray()).filter((r) => r.fileName === FILES[2].name);
    expect(forThatFile).toHaveLength(1);
    expect(forThatFile[0].rating).toBe(3);
  });
});

describe("runCollectionImport — a file that cannot be written", () => {
  it("costs that file only; the rest of the collection still arrives", async () => {
    const bad = FILES[1].name;
    const add = db.episodes.add.bind(db.episodes);
    const spy = vi.spyOn(db.episodes, "add").mockImplementation(((ep: { fileName: string }) =>
      ep.fileName === bad
        ? Promise.reject(new Error("QuotaExceededError"))
        : add(ep as never)) as never);

    const s = sink();
    try {
      const result = await runCollectionImport(new AbortController().signal, info, s);
      expect(result).toMatchObject({ outcome: "done", imported: 2 });
    } finally {
      spy.mockRestore();
    }

    const rows = await db.episodes.toArray();
    expect(rows.map((r) => r.fileName).sort()).toEqual([FILES[0].name, FILES[2].name].sort());
    expect(s.addError).toHaveBeenCalledWith(expect.stringContaining("QuotaExceededError"));
  });
});

describe("runCollectionImport — cancelling", () => {
  it("keeps what was already imported and stops there", async () => {
    const controller = new AbortController();
    // Abort while the first file is in flight. It still lands — the loop checks
    // the signal between files, and a write already issued is not worth tearing
    // up — and the check at the top of the next iteration ends the run.
    const s = sink((name) => {
      if (name === FILES[0].name) controller.abort();
    });

    const result = await runCollectionImport(controller.signal, info, s);
    expect(result.outcome).toBe("cancelled");
    expect(s.setPhase).toHaveBeenCalledWith("cancelled");
    expect(s.setPhase).not.toHaveBeenCalledWith("done");

    // The listener asked to stop, not to undo: file one survives, and the loop
    // really did stop rather than run to the end.
    const rows = await db.episodes.toArray();
    expect(rows.map((r) => r.fileName)).toEqual([FILES[0].name]);
    expect(result.imported).toBe(1);
  });
});
