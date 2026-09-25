import { beforeEach, describe, expect, it } from "vitest";
import { positionOf, progressOf, useProgressStore } from "@/stores/progress-store";

const A = "archive:coll:a.mp3";
const B = "archive:coll:b.mp3";

describe("progress-store (HD-016)", () => {
  beforeEach(() => useProgressStore.getState().reset());

  it("patch writes a new entry object and leaves the previous one untouched", () => {
    const s = useProgressStore.getState();
    s.patch(A, { playbackPosition: 10, lastPlayedAt: 1 });
    const first = progressOf(A)!;
    useProgressStore.getState().patch(A, { playbackPosition: 20 });
    const second = progressOf(A)!;
    expect(second).not.toBe(first);
    expect(first).toEqual({ fileHash: A, playbackPosition: 10, lastPlayedAt: 1 });
    expect(second).toEqual({ fileHash: A, playbackPosition: 20, lastPlayedAt: 1 });
    expect(positionOf(A)).toBe(20);
    expect(positionOf(B)).toBeUndefined();
    expect(positionOf(undefined)).toBeUndefined();
  });

  it("replaceAll keeps unchanged entries' identity and makes no state change when nothing changed", () => {
    const s = useProgressStore.getState();
    s.replaceAll([
      { fileHash: A, playbackPosition: 10, lastPlayedAt: 1 },
      { fileHash: B, lastPlayedAt: 2 },
    ]);
    const map1 = useProgressStore.getState().byHash;
    const a1 = map1.get(A);
    expect(useProgressStore.getState().loaded).toBe(true);

    // Same numbers, fresh objects (what a live query hands back): no change at all.
    useProgressStore.getState().replaceAll([
      { fileHash: A, playbackPosition: 10, lastPlayedAt: 1 },
      { fileHash: B, lastPlayedAt: 2 },
    ]);
    expect(useProgressStore.getState().byHash).toBe(map1);

    // B changes: a new map, but A's entry is the same object.
    useProgressStore.getState().replaceAll([
      { fileHash: A, playbackPosition: 10, lastPlayedAt: 1 },
      { fileHash: B, lastPlayedAt: 3 },
    ]);
    const map2 = useProgressStore.getState().byHash;
    expect(map2).not.toBe(map1);
    expect(map2.get(A)).toBe(a1);
    expect(map2.get(B)?.lastPlayedAt).toBe(3);
  });

  it("started keeps its identity until its membership changes", () => {
    useProgressStore.getState().patch(A, { playbackPosition: 10 });
    const started1 = useProgressStore.getState().started;
    expect([...started1]).toEqual([A]);

    useProgressStore.getState().patch(A, { playbackPosition: 30 });
    expect(useProgressStore.getState().started).toBe(started1);

    useProgressStore.getState().patch(B, { lastPlayedAt: 5 });
    expect(useProgressStore.getState().started).toBe(started1);

    useProgressStore.getState().patch(A, { playbackPosition: 0 });
    const started2 = useProgressStore.getState().started;
    expect(started2).not.toBe(started1);
    expect(started2.size).toBe(0);
  });
});
