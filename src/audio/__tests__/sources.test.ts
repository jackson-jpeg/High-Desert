import { describe, it, expect } from "vitest";
import { resolveSources, fallbacksFor, isFailoverKind, mirrorUrl, planStart } from "@/audio/sources";
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
