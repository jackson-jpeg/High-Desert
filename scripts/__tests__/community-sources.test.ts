import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The shows a listener's torrents named, added from archive.org copies
 * (docs/community-sources.md, scripts/import-community-sources.mjs).
 */

const { rowFor, merge, archiveFileHash } = await import("../import-community-sources.mjs");
const ROOT = path.resolve(__dirname, "../..");
const sources = JSON.parse(readFileSync(path.join(ROOT, "data/community-sources.json"), "utf8"));
const catalog: { fileHash: string; airDate: string; title: string; guestName?: string; topic?: string; archiveIdentifier: string }[] =
  JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));

const ENTRY = {
  archiveIdentifier: "Art-Bell_Midnight_In_the_Desert",
  fileName: "2015-11-30 - Art Bell MITD - Ken Gerhard Flying Humanoids.mp3",
  airDate: "2015-11-30",
  show: "Midnight in the Desert",
  showType: "special",
  guestName: "Ken Gerhard",
  topic: "Flying Humanoids",
};

describe("a row, as collection import builds one", () => {
  it("identity, stream URL, and size and duration from archive.org's record", () => {
    const row = rowFor(ENTRY, { size: "59431214", length: "8594.57" });
    expect(row).toEqual({
      fileHash: "archive:Art-Bell_Midnight_In_the_Desert:2015-11-30 - Art Bell MITD - Ken Gerhard Flying Humanoids.mp3",
      fileName: ENTRY.fileName,
      filePath: "https://archive.org/download/Art-Bell_Midnight_In_the_Desert/2015-11-30%20-%20Art%20Bell%20MITD%20-%20Ken%20Gerhard%20Flying%20Humanoids.mp3",
      fileSize: 59431214,
      title: "Midnight in the Desert - Flying Humanoids",
      artist: "Art Bell",
      airDate: "2015-11-30",
      guestName: "Ken Gerhard",
      showType: "special",
      topic: "Flying Humanoids",
      duration: 8594.57,
      format: "mp3",
      source: "archive",
      sourceUrl: row.filePath,
      archiveIdentifier: "Art-Bell_Midnight_In_the_Desert",
      aiStatus: "pending",
    });
  });

  it("refuses a Midnight in the Desert after Art Bell's last, on 2015-12-11", () => {
    expect(() => rowFor({ ...ENTRY, airDate: "2016-03-11" }, { size: "1", length: "1" })).toThrow(/2015-12-11/);
    expect(rowFor({ ...ENTRY, airDate: "2015-12-11" }, { size: "1", length: "1" }).airDate).toBe("2015-12-11");
  });

  it("refuses a file archive.org does not list, or lists with no length", () => {
    expect(() => rowFor(ENTRY, undefined)).toThrow(/archive.org has no/);
    expect(() => rowFor(ENTRY, { size: "5", length: "" })).toThrow(/no size or length/);
  });
});

describe("merging into the catalog", () => {
  const old = [
    { fileHash: "a", airDate: "1990-01-01", title: "keep me" },
    { fileHash: "b", airDate: "2000-01-01", title: "and me" },
  ];

  it("adds only what is missing, never touches an existing row, and keeps air-date order", () => {
    const { catalog: next, added } = merge(old, [
      { fileHash: "b", airDate: "2000-01-01", title: "a rewrite" },
      { fileHash: "c", airDate: "1995-06-01", title: "new" },
      { fileHash: "d", airDate: "2015-01-01", title: "newer" },
    ]);
    expect(added.map((r: { fileHash: string }) => r.fileHash)).toEqual(["c", "d"]);
    expect(next.map((r: { fileHash: string }) => r.fileHash)).toEqual(["a", "c", "b", "d"]);
    expect(next[2]).toBe(old[1]);
  });
});

describe("what was added", () => {
  const added = sources.added as (typeof ENTRY & { airDate: string })[];

  it("every entry is in the catalog under its canonical key, once", () => {
    const keys = new Map<string, number>();
    for (const e of catalog) keys.set(e.fileHash, (keys.get(e.fileHash) ?? 0) + 1);
    for (const e of added) expect(keys.get(archiveFileHash(e.archiveIdentifier, e.fileName)), e.fileName).toBe(1);
  });

  it("only Art Bell's own Midnight in the Desert: nothing after he stepped down on 2015-12-11", () => {
    const mitd = added.filter((e) => e.show === "Midnight in the Desert");
    expect(mitd.length).toBeGreaterThan(0);
    for (const e of mitd) expect(e.airDate <= "2015-12-11", e.fileName).toBe(true);
    const inCatalog = catalog.filter((e) => e.archiveIdentifier === "Art-Bell_Midnight_In_the_Desert");
    for (const e of inCatalog) expect(e.airDate <= "2015-12-11", e.title).toBe(true);
  });

  it("titles, guests and topics are copy a listener reads: no em dash", () => {
    for (const e of catalog.filter((c) => c.archiveIdentifier !== "ultimate-ultimate-art-bell-collection")) {
      expect(`${e.title} ${e.guestName ?? ""} ${e.topic ?? ""}`).not.toMatch(/—/);
    }
  });

  it("the catalog stays in air-date order", () => {
    for (let i = 1; i < catalog.length; i++) expect(catalog[i - 1].airDate <= catalog[i].airDate, catalog[i].title).toBe(true);
  });
});

describe("the torrents are not in the app", () => {
  // The three infohashes a listener sent, spelled out only here, split so this
  // file is not itself a match.
  const HASHES = ["93fc757f" + "796781a62536cf2c4af969d2ded8460c", "52140830" + "6e9476e2d3a0fa6fc82b42bd17cec180", "d178cf21" + "e2dbf6f86519474ce659da33a2e03428"];

  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) yield* files(p);
      else yield p;
    }
  }

  it("no infohash or magnet of theirs anywhere under public/, src/, data/ or services/", () => {
    for (const dir of ["public", "src", "data", "services"]) {
      for (const f of files(path.join(ROOT, dir))) {
        if (!/\.(json|ts|tsx|mjs|js|html|txt|md)$/.test(f)) continue;
        const text = readFileSync(f, "utf8").toLowerCase();
        for (const h of HASHES) expect(text.includes(h), `${f} names ${h.slice(0, 8)}`).toBe(false);
      }
    }
  });
});
