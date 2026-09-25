import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Export / Import My Data (HD-010), end to end on real Dexie.
 *
 * The listener's data is created through the app's own write functions, not
 * by writing rows the way this test imagines the app writes them. The export
 * goes through JSON text, as a real file does. And the profile it is imported
 * into is a *fresh* one, seeded from the real catalog **in a different order**,
 * so every episode has a different numeric id than it had when exported: an
 * import that matched on `id` instead of `fileHash` would attach every
 * favourite to the wrong show, and here it would fail.
 *
 * Every assertion is on what SURVIVED, and on which episode it is attached to.
 */

// Seeding the real 1,312-row catalog into fake-indexeddb, several times per
// file, does not fit vitest's 5s default on a loaded machine — and a test that
// times out mid-transaction leaves writes landing in the next test's profile,
// so the first failure spreads. The budget is the machine's, not the code's.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));
vi.mock("@/audio/cache", () => ({
  removeCachedAudio: () => Promise.resolve(),
  isOPFSSupported: () => false,
}));

const { db, setPreference, getPreference } = await import("@/db");
const { toEpisodeRow } = await import("@/db/seed");
const m = await import("@/services/episodes/management");
const { writeProgress } = await import("@/services/episodes/progress");
const {
  buildUserDataExport, parseUserData, previewUserDataImport, importUserData, isEmptyImport,
  USER_DATA_FORMAT, USER_DATA_VERSION,
} = await import("../portable");

const SEED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../public/seed/library.json"), "utf8"),
) as Record<string, unknown>[];
const H = SEED.map((r) => r.fileHash as string);

/**
 * A profile that has never been used, seeded from the real catalog.
 *
 * `rows` is the whole 1,312-row file where the point is the whole catalog, and
 * a slice of the same file elsewhere — seeding 1,312 rows per test costs more
 * than it proves when the test is about a malformed envelope. The rows are
 * always real ones, and `reversed` gives every episode a different id than it
 * had in the profile it was exported from.
 */
async function freshProfile(order: "catalog" | "reversed" = "catalog", rows = SEED): Promise<void> {
  db.close();
  await db.delete();
  await db.open();
  const ordered = order === "catalog" ? rows : [...rows].reverse();
  await db.episodes.bulkAdd(ordered.map((r) => toEpisodeRow(r, 1)) as never);
}

/** Enough of the catalog for everything `listen()` touches. */
const SMALL = SEED.slice(0, 70);

async function idOf(hash: string): Promise<number> {
  return (await db.episodes.where("fileHash").equals(hash).first())!.id!;
}

/** Everything a listener owns, as {hash → …}: comparable across profiles. */
async function snapshot() {
  const eps = await db.episodes.toArray();
  const byId = new Map(eps.map((e) => [e.id!, e.fileHash]));
  return {
    favourites: eps.filter((e) => e.favoritedAt).map((e) => e.fileHash).sort(),
    ratings: Object.fromEntries(eps.filter((e) => e.rating).map((e) => [e.fileHash, e.rating])),
    flags: eps.filter((e) => e.flaggedAt).map((e) => e.fileHash).sort(),
    // Positions live in the `progress` table (HD-016), keyed by fileHash.
    positions: Object.fromEntries((await db.progress.toArray()).filter((p) => p.playbackPosition).map((p) => [p.fileHash, p.playbackPosition])),
    history: (await db.history.toArray()).map((h) => `${byId.get(h.episodeId)}@${h.timestamp}`).sort(),
    bookmarks: (await db.bookmarks.toArray()).map((b) => `${byId.get(b.episodeId)}@${b.position}:${b.label}`).sort(),
    playlists: Object.fromEntries((await db.playlists.toArray()).map((p) => [p.name, p.episodeIds.map((id) => byId.get(id))])),
  };
}

/** A listener's evening, through the app's own functions. */
async function listen(): Promise<void> {
  await m.toggleFavorite(await idOf(H[0]));
  await m.toggleFavorite(await idOf(H[10]));
  await m.rateEpisode(await idOf(H[0]), 5);
  await m.rateEpisode(await idOf(H[20]), 3);
  await m.toggleFlag(await idOf(H[30]));
  // What the player's position timer writes — through its own writer.
  await writeProgress(H[10], { playbackPosition: 4321, lastPlayedAt: 2_000 });
  await writeProgress(H[40], { playbackPosition: 60, lastPlayedAt: 1_000 });
  // What the layout writes when a show starts.
  await db.history.add({ episodeId: await idOf(H[10]), timestamp: 1_500, duration: 3600, episodeTitle: SEED[10].title as string });
  await db.history.add({ episodeId: await idOf(H[40]), timestamp: 900, duration: 60 });
  await m.addBookmark(await idOf(H[10]), 1800, "Area 51 caller");
  const pl = (await db.playlists.add({ name: "Late night", episodeIds: [], createdAt: 5, updatedAt: 5 })) as number;
  await m.addToPlaylist(pl, [await idOf(H[20]), await idOf(H[0])]);
  await setPreference("text-scale", "1.15");
  await setPreference("queue-ids", JSON.stringify([await idOf(H[0])])); // local ids: must not travel
}

const EXPECTED = {
  favourites: [H[0], H[10]].sort(),
  ratings: { [H[0]]: 5, [H[20]]: 3 },
  flags: [H[30]],
  positions: { [H[10]]: 4321, [H[40]]: 60 },
  history: [`${H[10]}@1500`, `${H[40]}@900`].sort(),
  bookmarks: [`${H[10]}@1800:Area 51 caller`],
  playlists: { "Late night": [H[20], H[0]] },
};

async function exportText(): Promise<string> {
  return JSON.stringify(await buildUserDataExport(new Date("2026-09-22T00:00:00Z")));
}

function parsed(text: string) {
  const r = parseUserData(text);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
}

describe("export → fresh profile → import", () => {
  beforeEach(async () => {
    await freshProfile();
  });

  it("every favourite, rating, flag, position, history entry, bookmark and playlist survives, on the right episode", async () => {
    await listen();
    expect(await snapshot()).toEqual(EXPECTED); // the setup did what it says
    const text = await exportText();

    // A new device: the same catalog, seeded in another order, so ids differ.
    await freshProfile("reversed");
    expect(await idOf(H[0])).not.toBe(1);
    expect((await snapshot()).favourites).toEqual([]);

    const data = parsed(text);
    const preview = await previewUserDataImport(data);
    expect(preview).toMatchObject({ favourites: 2, ratings: 2, flags: 1, positions: 2, history: 2, bookmarks: 1, playlistsCreated: 1, prefs: 1, unmatched: 0 });
    // A preview writes nothing.
    expect((await snapshot()).favourites).toEqual([]);

    expect(await importUserData(data)).toEqual(preview);
    expect(await snapshot()).toEqual(EXPECTED);
    expect((await db.progress.get(H[10]))?.lastPlayedAt).toBe(2_000);
    expect(await getPreference("text-scale")).toBe("1.15");
    expect(await getPreference("queue-ids")).toBeUndefined();
    // Nothing else in the catalog was touched.
    expect(await db.episodes.count()).toBe(SEED.length);
  });

  it("identifies episodes by fileHash in the file, never by local id", async () => {
    await listen();
    const text = await exportText();
    expect(text).not.toMatch(/"(episodeId|episodeIds|id)"\s*:/);
    expect(parsed(text).episodes.map((e) => e.fileHash)).toEqual(expect.arrayContaining([H[0], H[10], H[20], H[30], H[40]]));
  });

  it("importing the same file twice changes nothing the second time", async () => {
    await listen();
    const text = await exportText();
    await freshProfile("reversed");
    await importUserData(parsed(text));
    const once = await snapshot();
    const again = await importUserData(parsed(text));
    expect(isEmptyImport(again)).toBe(true);
    expect(await snapshot()).toEqual(once);
    expect(await db.history.count()).toBe(2);
  });
});

describe("import into a profile that already has data keeps both", () => {
  beforeEach(async () => {
    await freshProfile("catalog", SMALL);
  });

  it("merges: existing favourites, ratings, history and playlists stay; imported ones are added; conflicts keep the local value", async () => {
    await listen();
    const text = await exportText();

    await freshProfile("reversed", SMALL);
    // This profile's own evening.
    await m.toggleFavorite(await idOf(H[50]));
    await m.rateEpisode(await idOf(H[0]), 2); // conflicts with the file's 5
    await db.history.add({ episodeId: await idOf(H[50]), timestamp: 7_000, duration: 10 });
    await m.addBookmark(await idOf(H[50]), 5, "mine");
    const late = (await db.playlists.add({ name: "Late night", episodeIds: [await idOf(H[50])], createdAt: 1, updatedAt: 1 })) as number;
    await db.playlists.add({ name: "Other", episodeIds: [await idOf(H[60])], createdAt: 1, updatedAt: 1 });
    // A more recent listen here than the file's.
    await writeProgress(H[10], { playbackPosition: 99, lastPlayedAt: 9_000 });
    await setPreference("text-scale", "1.3");

    await importUserData(parsed(text));
    const after = await snapshot();

    expect(after.favourites).toEqual([H[0], H[10], H[50]].sort());
    expect(after.ratings).toEqual({ [H[0]]: 2, [H[20]]: 3 });
    expect(after.flags).toEqual([H[30]]);
    expect(after.positions).toEqual({ [H[10]]: 99, [H[40]]: 60 });
    expect(after.history).toEqual([`${H[10]}@1500`, `${H[40]}@900`, `${H[50]}@7000`].sort());
    expect(after.bookmarks).toEqual([`${H[10]}@1800:Area 51 caller`, `${H[50]}@5:mine`].sort());
    // Same name: extended in place, not duplicated or replaced.
    expect(after.playlists).toEqual({ "Late night": [H[50], H[20], H[0]], Other: [H[60]] });
    expect(await db.playlists.count()).toBe(2);
    expect((await db.playlists.get(late))!.episodeIds).toHaveLength(3);
    expect(await getPreference("text-scale")).toBe("1.3");
  });

  it("skips and counts episodes this library does not have, and still imports the rest", async () => {
    await listen();
    const file = parsed(await exportText());
    file.episodes.push({ fileHash: "archive:elsewhere:not-here.mp3", favoritedAt: 5 });
    file.history.push({ fileHash: "archive:elsewhere:not-here.mp3", timestamp: 1, duration: 1 });
    await freshProfile("catalog", SMALL);
    const summary = await importUserData(file);
    expect(summary.unmatched).toBe(1);
    expect((await snapshot()).favourites).toEqual(EXPECTED.favourites);
  });

  it("runs in one transaction: a failure part-way leaves the profile exactly as it was", async () => {
    await listen();
    const text = await exportText();
    await freshProfile("reversed", SMALL);
    await m.toggleFavorite(await idOf(H[50]));
    const before = await snapshot();

    // Bookmarks are written after the episode fields and history.
    const spy = vi.spyOn(db.bookmarks, "bulkAdd").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(importUserData(parsed(text))).rejects.toThrow("disk full");
    spy.mockRestore();

    expect(await snapshot()).toEqual(before);
  });
});

describe("a file it should not trust changes nothing", () => {
  beforeEach(async () => {
    await freshProfile("catalog", SMALL);
  });

  const good = () => ({
    format: USER_DATA_FORMAT, version: USER_DATA_VERSION, exportedAt: "", prefs: {},
    episodes: [{ fileHash: H[0], favoritedAt: 5 }], history: [], bookmarks: [], playlists: [],
  });

  it.each([
    ["not JSON", "{nope"],
    ["another app's JSON", JSON.stringify({ episodes: [] })],
    ["the admin catalog", JSON.stringify(SEED.slice(0, 2))],
    ["a future version", JSON.stringify({ ...good(), version: USER_DATA_VERSION + 1 })],
    ["no version", JSON.stringify({ ...good(), version: undefined })],
    ["a rating of 9", JSON.stringify({ ...good(), episodes: [{ fileHash: H[0], rating: 9 }] })],
    ["an episode with no fileHash", JSON.stringify({ ...good(), episodes: [{ favoritedAt: 5 }] })],
    ["a bookmark with a string position", JSON.stringify({ ...good(), bookmarks: [{ fileHash: H[0], position: "10", label: "x", createdAt: 1 }] })],
    ["history that is not a list", JSON.stringify({ ...good(), history: { a: 1 } })],
  ])("refuses %s, and the profile is untouched", async (_label, text) => {
    await listen();
    const before = await snapshot();
    const r = parseUserData(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
  });

  it("the future-version refusal says to update, not that the file is broken", () => {
    const r = parseUserData(JSON.stringify({ ...good(), version: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/newer version/);
  });

  it("the valid baseline those are variations of is accepted — so each refusal is about its one defect", () => {
    expect(parseUserData(JSON.stringify(good())).ok).toBe(true);
  });
});
