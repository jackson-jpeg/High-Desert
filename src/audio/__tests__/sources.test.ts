import { describe, it, expect } from "vitest";
import { resolveSources, fallbacksFor, isFailoverKind, isRepaired, mirrorUrl, planStart } from "@/audio/sources";
import repairedEpisodes from "@/data/repaired-episodes.json";
import { readFileSync } from "node:fs";
import type { FailureKind } from "@/audio/playback-watchdog";

const ep = {
  fileHash: "archive:coll:1997-09-11 - Coast to Coast AM #1: Area 51?.mp3",
  sourceUrl: "https://archive.org/download/coll/x.mp3",
};

describe("resolveSources", () => {
  it("archive first, then the mirror", () => {
    expect(resolveSources(ep).map((s) => s.kind)).toEqual(["archive", "mirror"]);
  });
  it("only the mirror while archive.org is known down", () => {
    expect(resolveSources(ep, { archiveDown: true })).toEqual([{ kind: "mirror", url: mirrorUrl(ep) }]);
  });
  it("the mirror URL encodes the whole fileHash as one path segment", () => {
    expect(mirrorUrl(ep)).toBe(`/mirror/${encodeURIComponent(ep.fileHash)}`);
    expect(decodeURIComponent(mirrorUrl(ep)!.slice("/mirror/".length))).toBe(ep.fileHash);
  });
  it("an episode that is not in the catalog has no mirror", () => {
    const local = { fileHash: "md5:abc", sourceUrl: undefined };
    expect(resolveSources(local)).toEqual([]);
    expect(resolveSources(local, { archiveDown: true })).toEqual([]);
    expect(fallbacksFor(local, "local")).toEqual([]);
  });
  it("fallbacks: the mirror behind archive.org, nothing behind the mirror", () => {
    expect(fallbacksFor(ep, "archive").map((s) => s.kind)).toEqual(["mirror"]);
    expect(fallbacksFor(ep, "mirror")).toEqual([]);
    expect(fallbacksFor(ep, "cache")).toEqual([]);
  });
});

describe("a repaired episode plays from the mirror only (docs/broken-episodes.md)", () => {
  const catalog = JSON.parse(readFileSync("public/seed/library.json", "utf8")) as { fileHash: string; sourceUrl: string }[];
  const egypt = catalog.find((r) => r.airDate === "2001-11-26" && /Egypt/.test(r.fileHash))!;

  it("the 2001-11-26 Egyptian Cave show is in the catalog and repaired", () => {
    expect(egypt).toBeTruthy();
    expect(isRepaired(egypt)).toBe(true);
    expect(isRepaired(ep)).toBe(false);
  });

  it("its archive.org file, which changes stereo to mono at 43:59, is never offered: not first, not as a fallback", () => {
    expect(resolveSources(egypt)).toEqual([{ kind: "mirror", url: mirrorUrl(egypt) }]);
    expect(resolveSources(egypt, { archiveDown: true })).toEqual([{ kind: "mirror", url: mirrorUrl(egypt) }]);
    expect(fallbacksFor(egypt, "mirror")).toEqual([]);
    expect(planStart(egypt, { archiveDown: false, playable: null })).toEqual({ kind: "play", source: { kind: "mirror", url: mirrorUrl(egypt) } });
  });

  it("every repaired record is a catalog episode with one configuration, and the original it replaces had more", () => {
    const hashes = new Set(catalog.map((r) => r.fileHash));
    for (const r of repairedEpisodes) {
      expect(hashes.has(r.fileHash), r.fileHash).toBe(true);
      expect(r.original.segments.length, r.fileHash).toBeGreaterThan(1);
      expect(r.repaired.bytes).toBeGreaterThan(0);
      expect(r.repaired.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Math.abs(r.repaired.seconds - r.original.seconds)).toBeLessThanOrEqual(2);
    }
  });
});

describe("isFailoverKind", () => {
  it.each<[FailureKind, boolean]>([
    ["network-error", true],
    ["stall", true],
    ["timeout", true],
    ["play-rejected", false],
    ["decode-error", false],
    ["empty-media", false],
    ["empty-media-suspected", false],
  ])("%s → %s", (k, want) => expect(isFailoverKind(k)).toBe(want));
});

describe("planStart", () => {
  const pinned = new Set([ep.fileHash]);
  const other = { ...ep, fileHash: "archive:coll:1998-01-01 Other.mp3" };

  it("up: archive.org, whatever the manifest says", () => {
    expect(planStart(other, { archiveDown: false, playable: pinned })).toEqual({
      kind: "play",
      source: { kind: "archive", url: ep.sourceUrl },
    });
  });
  it("down: the mirror for a show it holds", () => {
    expect(planStart(ep, { archiveDown: true, playable: pinned })).toEqual({
      kind: "play",
      source: { kind: "mirror", url: mirrorUrl(ep) },
    });
  });
  it("down: unavailable for a show it does not hold", () => {
    expect(planStart(other, { archiveDown: true, playable: pinned })).toEqual({ kind: "unavailable" });
  });
  it("down with no manifest: try the mirror, never refuse on a guess", () => {
    expect(planStart(other, { archiveDown: true, playable: null })).toMatchObject({ kind: "play", source: { kind: "mirror" } });
  });
  it("no source at all is 'none', not 'unavailable'", () => {
    expect(planStart({ fileHash: "md5:abc", sourceUrl: undefined }, { archiveDown: true, playable: pinned })).toEqual({ kind: "none" });
  });
});
