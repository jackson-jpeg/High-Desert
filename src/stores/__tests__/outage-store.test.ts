import { describe, it, expect, beforeEach } from "vitest";
import { useOutageStore, availabilityOf, selectOutage } from "../outage-store";
import type { Episode } from "@/db/schema";

const s = () => useOutageStore.getState();
const PINNED = "archive:coll:1997-03-13 Phoenix Lights.mp3";
const OTHER = "archive:coll:1996-11-14 Hale-Bopp.mp3";
const manifest = (version: string, hashes: string[]) => ({ version, fileHashes: new Set(hashes) });

beforeEach(() => {
  useOutageStore.setState({ archiveUp: null, manifest: null, unavailable: null });
});

describe("the outage store", () => {
  it("unknown is not an outage — only a down verdict is", () => {
    expect(selectOutage(s())).toBe(false);
    s().setArchiveUp(true);
    expect(selectOutage(s())).toBe(false);
    s().setArchiveUp(false);
    expect(selectOutage(s())).toBe(true);
  });

  it("archive.org returning clears the refused show; going down does not invent one", () => {
    s().setArchiveUp(false);
    s().showUnavailable({ fileHash: OTHER } as Episode);
    expect(s().unavailable?.fileHash).toBe(OTHER);
    s().setArchiveUp(false);
    expect(s().unavailable?.fileHash).toBe(OTHER);
    s().setArchiveUp(true);
    expect(s().unavailable).toBeNull();
  });

  it("a manifest with the version already held is not a change", () => {
    const first = manifest("v1", [PINNED]);
    s().setManifest(first);
    s().setManifest(manifest("v1", [PINNED]));
    expect(s().manifest).toBe(first);
    s().setManifest(manifest("v2", [PINNED, OTHER]));
    expect(s().manifest?.fileHashes.has(OTHER)).toBe(true);
  });

  it("availability: normal while up or unknown; mirror/unavailable while down; local files never marked", () => {
    s().setManifest(manifest("v1", [PINNED]));
    expect(availabilityOf(s(), PINNED)).toBe("normal");
    expect(availabilityOf(s(), OTHER)).toBe("normal");
    s().setArchiveUp(false);
    expect(availabilityOf(s(), PINNED)).toBe("mirror");
    expect(availabilityOf(s(), OTHER)).toBe("unavailable");
    expect(availabilityOf(s(), "md5:0123")).toBe("normal");
    expect(availabilityOf(s(), undefined)).toBe("normal");
  });

  it("down with no manifest marks nothing — unknown is not unplayable", () => {
    s().setArchiveUp(false);
    expect(availabilityOf(s(), OTHER)).toBe("normal");
  });
});
