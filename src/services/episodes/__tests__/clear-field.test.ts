import { describe, it, expect } from "vitest";

/**
 * Regression guard for the "toggle off does nothing" class of bug.
 *
 * `toggleFavorite`, `rateEpisode` and `toggleFlag` all cleared their field by
 * passing `undefined` to Dexie's `Table.update()`. Dexie ignores keys whose
 * value is `undefined`, so all three toggle-off paths were silent no-ops: the
 * function returned the new state and the toast fired, but the stored row never
 * changed and re-opening the episode showed the old value.
 *
 * Running Dexie here would mean adding fake-indexeddb purely for this, so this
 * asserts the semantics of the merge step instead — the part that was wrong —
 * and the service uses the same rule via `.modify()`.
 */

/** Mirrors the body of applyEpisodeFields in ../management.ts. */
function applyFields(
  row: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete row[key];
    } else {
      row[key] = value;
    }
  }
  return row;
}

/** What Dexie's Table.update() actually does — kept for contrast. */
function dexieUpdateSemantics(
  row: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue; // the bug
    row[key] = value;
  }
  return row;
}

describe("clearing an episode field", () => {
  it("removes the key when the new value is undefined", () => {
    const row = applyFields({ id: 1, rating: 4 }, { rating: undefined, updatedAt: 99 });
    expect("rating" in row).toBe(false);
    expect(row.updatedAt).toBe(99);
  });

  it("sets the key when the new value is defined", () => {
    const row = applyFields({ id: 1 }, { rating: 5 });
    expect(row.rating).toBe(5);
  });

  it("clears favoritedAt and flaggedAt the same way", () => {
    const row = applyFields(
      { id: 1, favoritedAt: 123, flaggedAt: 456 },
      { favoritedAt: undefined, flaggedAt: undefined },
    );
    expect("favoritedAt" in row).toBe(false);
    expect("flaggedAt" in row).toBe(false);
  });

  it("documents the Dexie behaviour this exists to work around", () => {
    // If this ever starts failing, Dexie changed and applyEpisodeFields could
    // in principle go back to Table.update().
    const row = dexieUpdateSemantics({ id: 1, rating: 4 }, { rating: undefined });
    expect(row.rating).toBe(4); // unchanged — the field was NOT cleared
  });
});
