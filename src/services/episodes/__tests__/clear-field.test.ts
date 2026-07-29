import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Regression guard for the "toggle off does nothing" class of bug.
 *
 * `toggleFavorite`, `rateEpisode` and `toggleFlag` all cleared their field by
 * passing `undefined` to Dexie's `Table.update()`. Dexie ignores keys whose
 * value is `undefined`, so all three toggle-off paths were silent no-ops: the
 * function returned the new state and the toast fired, but the stored row never
 * changed and re-opening the episode showed the old value.
 *
 * This used to assert against a hand-written copy of `applyEpisodeFields`, on
 * the grounds that running Dexie would mean adding fake-indexeddb "purely for
 * this". Two problems with that. The copy could not fail while the real
 * function drifted, and — worse — it tested the wrong thing entirely: the merge
 * rule was never in doubt, the defect was `.update()` vs `.modify()` at the
 * *call site*. A test that models the merge would have passed on the broken
 * code, because the broken code's merge rule was fine; it simply never ran.
 *
 * So: real Dexie, real IndexedDB, real service functions, asserting on the
 * stored row.
 */

// deleteEpisode reaches for OPFS; nothing here calls it, but the module is
// imported as a whole and jsdom has no navigator.storage.
vi.mock("@/audio/cache", () => ({
  removeCachedAudio: vi.fn(() => Promise.resolve()),
  isOPFSSupported: () => false,
}));

const { db } = await import("@/db");
const { toggleFavorite, rateEpisode, toggleFlag } = await import(
  "../management"
);

type Row = Record<string, unknown>;

async function seedEpisode(over: Row = {}): Promise<number> {
  const id = await db.episodes.add({
    fileHash: `archive:coll:show-${Math.random()}.mp3`,
    fileName: "1997-07-28 - Coast to Coast AM with Art Bell.mp3",
    title: "Coast to Coast AM — Men in Black",
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return id as number;
}

/** The stored row, as a plain object — `in` is the whole point here. */
async function stored(id: number): Promise<Row> {
  const row = await db.episodes.get(id);
  return row as unknown as Row;
}

describe("clearing an episode field", () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.episodes.clear();
  });

  it("un-favouriting removes favoritedAt from the stored row", async () => {
    const id = await seedEpisode();

    expect(await toggleFavorite(id)).toBe(true);
    expect((await stored(id)).favoritedAt).toEqual(expect.any(Number));

    expect(await toggleFavorite(id)).toBe(false);
    // Not "is falsy" — the bug left the old timestamp in place, and a falsy
    // check would have passed on `favoritedAt: 0` while failing to notice.
    expect("favoritedAt" in (await stored(id))).toBe(false);
  });

  it("un-rating removes rating from the stored row", async () => {
    const id = await seedEpisode();

    await rateEpisode(id, 4);
    expect((await stored(id)).rating).toBe(4);

    await rateEpisode(id, undefined);
    expect("rating" in (await stored(id))).toBe(false);
  });

  it("an out-of-range rating clears rather than stores nonsense", async () => {
    const id = await seedEpisode({ rating: 3 });
    await rateEpisode(id, 9);
    expect("rating" in (await stored(id))).toBe(false);
  });

  it("un-flagging removes flaggedAt from the stored row", async () => {
    const id = await seedEpisode();

    expect(await toggleFlag(id)).toBe(true);
    expect((await stored(id)).flaggedAt).toEqual(expect.any(Number));

    expect(await toggleFlag(id)).toBe(false);
    expect("flaggedAt" in (await stored(id))).toBe(false);
  });

  it("clearing one field leaves the rest of the row alone", async () => {
    // applyEpisodeFields walks the row by key and deletes; a sloppier
    // implementation could take the whole record with it.
    const id = await seedEpisode({ favoritedAt: 111, rating: 5 });

    await rateEpisode(id, undefined);

    const row = await stored(id);
    expect("rating" in row).toBe(false);
    expect(row.favoritedAt).toBe(111);
    expect(row.title).toBe("Coast to Coast AM — Men in Black");
    expect(row.updatedAt).toEqual(expect.any(Number));
  });

  it("records what Dexie 4.3.0 actually does with an undefined value", async () => {
    // The old version of this test asserted the opposite — that `update()`
    // ignores undefined and leaves the old value in place — and passed, because
    // it asserted against a hand-written model of Dexie instead of Dexie. It
    // does not. 4.3.0 deletes the key, exactly as `.modify()` does.
    //
    // Which means the premise `applyEpisodeFields` was written on was not true
    // for the version this repo has ever had installed: `dexie` has been pinned
    // `^4.3.0` since the first commit and has never been upgraded. Whatever made
    // ratings and favourites appear uncleared, it was not this. The other half
    // of that fix — the detail panel rendering a stale `useState` snapshot
    // instead of the live query — is real and is the likelier culprit.
    //
    // `applyEpisodeFields` stays: it is explicit about intent and does not
    // depend on a third-party library's treatment of undefined staying put. But
    // it is not load-bearing for this behaviour, and the note in CLAUDE.md
    // claiming otherwise has been corrected.
    const id = await seedEpisode({ rating: 4 });

    await db.episodes.update(id, { rating: undefined });

    expect("rating" in (await stored(id))).toBe(false);
  });
});
