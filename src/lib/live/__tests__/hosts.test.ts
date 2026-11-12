// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { NOT_ART_HOSTED } from "../schedule";

/**
 * Who hosted each catalog show (docs/hosts.md, scripts/classify-hosts.mjs).
 * The station airs only Art Bell's own nights; a show the classification does
 * not know cannot be trusted to be his, so every catalog row must be in it.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const read = (p: string) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));
const catalog: { fileHash: string; fileName: string }[] = read("public/seed/library.json");
const hosts: { art: Record<string, string>; notArt: Record<string, { host: string; evidence: string }> } = read("data/hosts.json");

describe("data/hosts.json", () => {
  it("classifies every catalog show exactly once: a new import fails here until scripts/classify-hosts.mjs has placed it", () => {
    for (const r of catalog) {
      const n = (r.fileHash in hosts.art ? 1 : 0) + (r.fileHash in hosts.notArt ? 1 : 0);
      expect(n, r.fileName).toBe(1);
    }
    expect(Object.keys(hosts.art).length + Object.keys(hosts.notArt).length).toBe(catalog.length);
  });

  it("the station's list is exactly the shows classified as not Art's", () => {
    expect([...NOT_ART_HOSTED].sort()).toEqual(Object.keys(hosts.notArt).sort());
    // The phone lines' service reads the same file through its symlink.
    expect(realpathSync(path.join(ROOT, "services/live/lib/shared/not-art-hosted.json"))).toBe(
      realpathSync(path.join(ROOT, "src/data/not-art-hosted.json")),
    );
  });

  it("names the night the listeners caught (2026-11-12) and the guest hosts the archive marks", () => {
    const by = (host: string) => Object.entries(hosts.notArt).filter(([, v]) => v.host === host).map(([h]) => h);
    expect(by("George Noory").some((h) => h.includes("2001-11-12"))).toBe(true);
    expect(by("Hilly Rose")).toHaveLength(6);
    // Every exclusion says why.
    for (const v of Object.values(hosts.notArt)) expect(v.evidence.length).toBeGreaterThan(10);
  });

  it("keeps the excluded shows small: the station loses a handful, not the archive", () => {
    expect(NOT_ART_HOSTED.size).toBeLessThan(catalog.length / 20);
  });
});
