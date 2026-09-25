import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * HD-040, two small data-path properties, against a real (fake-indexeddb)
 * database rather than a model of one:
 *
 *   - `setPreference` is an atomic upsert. It was read-then-write in two
 *     transactions, so two concurrent writers of a new key both read "absent",
 *     both `add`ed, and the second hit the `&key` unique index.
 *   - A catalog tombstone never ages out. The list was cut to its newest 2,000
 *     entries, so enough later deletions (local files) silently un-deleted a
 *     catalog show at the next reconcile.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db, setPreference, getPreference } = await import("@/db");
const { addTombstone } = await import("@/db/seed");

beforeEach(async () => {
  await db.userPrefs.clear();
});

describe("setPreference", () => {
  it("concurrent writers of a new key neither fail nor duplicate it", async () => {
    const writes = ["a", "b", "c", "d", "e"].map((v) => setPreference("volume", v));
    const settled = await Promise.allSettled(writes);
    expect(settled.filter((s) => s.status === "rejected")).toEqual([]);
    const rows = await db.userPrefs.where("key").equals("volume").toArray();
    expect(rows).toHaveLength(1);
    // Transactions on one store run in order: the last writer wins.
    expect(rows[0].value).toBe("e");
  });

  it("updates an existing key in place", async () => {
    await setPreference("k", "1");
    await setPreference("k", "2");
    expect(await getPreference("k")).toBe("2");
    expect(await db.userPrefs.count()).toBe(1);
  });
});

describe("tombstones", () => {
  const read = async () => JSON.parse((await getPreference("deleted-hashes")) ?? "[]") as string[];

  it("a catalog tombstone survives any number of later deletions", async () => {
    const catalog = "archive:ultimate-ultimate-art-bell-collection:1997-03-13.mp3";
    await addTombstone(catalog);
    // Local-file hashes (MD5s) are what the cap is for.
    const prefs = Array.from({ length: 2050 }, (_, i) => `local-md5-${i}`);
    const list = [catalog, ...prefs];
    await setPreference("deleted-hashes", JSON.stringify(list));
    await addTombstone("local-md5-final");

    const after = await read();
    expect(after).toContain(catalog);
    // The cap still applies to everything else, oldest first.
    const local = after.filter((h) => !h.startsWith("archive:"));
    expect(local).toHaveLength(2000);
    expect(local[local.length - 1]).toBe("local-md5-final");
    expect(local).not.toContain("local-md5-0");
  });

  it("the cap is 2,000 local entries, not 2,000 entries", async () => {
    const archive = Array.from({ length: 1500 }, (_, i) => `archive:c:${i}.mp3`);
    const local = Array.from({ length: 1999 }, (_, i) => `md5-${i}`);
    await setPreference("deleted-hashes", JSON.stringify([...archive, ...local]));
    await addTombstone("md5-new");
    const after = await read();
    expect(after).toHaveLength(1500 + 2000);
    expect(after.slice(0, 1500)).toEqual(archive);
  });
});
