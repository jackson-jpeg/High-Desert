import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SEED_VERSION } from "@/db/seed";

/**
 * reconcileLibrary() runs once per SEED_VERSION, so a catalog that gains shows
 * without a bump reaches only visitors who seed afterwards. That happened on
 * 2026-09-28 (101 shows), and On Air showed the missing rows' ids for three
 * days. The catalog's set of shows is recorded here against the version that
 * shipped it: change the set, bump SEED_VERSION, and update both lines.
 */
const SHIPPED = {
  version: "2026-10-09-a",
  shows: 1413,
  digest: "ca150ca272c40b22c7c46eb6a63e6e49b78c3b2cf3e80baab0d16b219e582898",
};

function catalogDigest(): { shows: number; digest: string } {
  const rows = JSON.parse(readFileSync(path.join(process.cwd(), "public", "seed", "library.json"), "utf8")) as {
    fileHash: string;
  }[];
  const digest = createHash("sha256")
    .update(rows.map((r) => r.fileHash).sort().join("\n"))
    .digest("hex");
  return { shows: rows.length, digest };
}

describe("SEED_VERSION follows the catalog", () => {
  it("the shipped set of shows is the one recorded for this SEED_VERSION", () => {
    const now = catalogDigest();
    if (now.digest !== SHIPPED.digest) {
      // The set changed: the version must have moved with it.
      expect(SEED_VERSION, "the catalog's shows changed: bump SEED_VERSION and record the new digest here").not.toBe(
        SHIPPED.version,
      );
    }
    expect({ version: SEED_VERSION, ...now }).toEqual(SHIPPED);
  });
});
