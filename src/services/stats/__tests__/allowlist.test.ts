import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isKnownEpisodeId, knownEpisodeIdCount } from "../allowlist";
import { communityKey } from "@/lib/utils/community-key";

/**
 * The generated allowlist must stay in sync with the shipped catalog. If it
 * drifts, either real plays get rejected (404-ing the feature) or forged ids
 * get through — so this test fails loudly rather than either happening quietly.
 *
 * Regenerate with: node scripts/gen-community-keys.mjs
 */

const root = path.resolve(__dirname, "../../../..");
const raw = JSON.parse(
  fs.readFileSync(path.join(root, "public/seed/library.json"), "utf8"),
);
const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.episodes;

const expected = [
  ...new Set(
    rows
      .map((r) =>
        communityKey(r as { archiveIdentifier?: string | null; fileName: string }),
      )
      .filter((k): k is string => !!k),
  ),
];

describe("community key allowlist", () => {
  it("matches the seed catalog exactly", () => {
    expect(knownEpisodeIdCount()).toBe(expected.length);
    for (const key of expected) {
      expect(isKnownEpisodeId(key)).toBe(true);
    }
  });

  it("covers every catalog episode", () => {
    expect(expected.length).toBe(rows.length);
  });

  it("rejects ids that are not in the catalog", () => {
    expect(isKnownEpisodeId("zz-probe-does-not-exist")).toBe(false);
    // The legacy bare-collection key that accumulated 867 plays before keys
    // included the filename — must not be writable again.
    expect(isKnownEpisodeId("ultimate-ultimate-art-bell-collection")).toBe(false);
    expect(isKnownEpisodeId("")).toBe(false);
  });

  it("only contains ids the API routes consider valid", () => {
    const pattern = /^[a-zA-Z0-9._-]+$/;
    for (const key of expected) {
      expect(pattern.test(key)).toBe(true);
      expect(key.length).toBeLessThanOrEqual(200);
    }
  });
});
