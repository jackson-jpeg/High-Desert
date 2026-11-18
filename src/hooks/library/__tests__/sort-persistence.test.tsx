import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { db, getPreference } from "@/db";
import { useLibraryFilters, SORT_PREF_KEY } from "@/hooks/library/useLibraryFilters";

/**
 * The chosen sort is remembered per visitor. Drives the real hook against the
 * real Dexie database (fake-indexeddb): pick a sort, unmount — a reload, as far
 * as the hook can tell — mount again, and the sort must come back.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useLibraryFilters> | null = null;
const publish = (v: ReturnType<typeof useLibraryFilters>) => { api = v; };
function Harness() {
  const v = useLibraryFilters();
  // Published after commit, which is what a test reading state wants anyway.
  useEffect(() => publish(v));
  return null;
}

let root: Root;
let host: HTMLDivElement;
function mount() {
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
}
function unmount() {
  act(() => root.unmount());
  api = null;
}
/** Let Dexie's promise chain settle inside act. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

beforeEach(async () => {
  await db.userPrefs.clear();
  await db.progress.clear();
  await db.history.clear();
  // A browser that has listened: the persistence cases below are about the
  // stored sort, not the new visitor's first order.
  await db.progress.put({ fileHash: "archive:x:y.mp3", playbackPosition: 12, lastPlayedAt: 1 });
});
afterEach(() => {
  if (api) unmount();
});

describe("a new visitor's first order (src/lib/library/first-sort.ts)", () => {
  let width = 1440;
  const real = window.matchMedia;
  beforeEach(async () => {
    await db.progress.clear();
    width = 1440;
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 768px)" && width >= 768,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = real;
  });

  it("control: a phone keeps newest first (left alone until the look split's verdict)", async () => {
    width = 390;
    mount();
    await settle();
    expect(api!.sortMode).toBe("date");
  });

  it("no stored sort and no history: opens on Most played, and does not store it", async () => {
    mount();
    expect(api!.sortMode).toBe("date"); // the server render
    await settle();
    expect(api!.sortMode).toBe("played");
    expect(await getPreference(SORT_PREF_KEY)).toBeUndefined();
  });

  it("control: a saved position alone keeps newest first", async () => {
    await db.progress.put({ fileHash: "archive:x:y.mp3", playbackPosition: 12, lastPlayedAt: 1 });
    mount();
    await settle();
    expect(api!.sortMode).toBe("date");
  });

  it("control: a history entry alone keeps newest first", async () => {
    await db.history.add({ episodeId: 1, timestamp: 1, duration: 30 } as never);
    mount();
    await settle();
    expect(api!.sortMode).toBe("date");
  });

  it("a stored sort wins over the new visitor's order", async () => {
    await db.userPrefs.add({ key: SORT_PREF_KEY, value: "name" });
    mount();
    await settle();
    expect(api!.sortMode).toBe("name");
  });

  it("a sort picked by the new visitor is the one remembered", async () => {
    mount();
    await settle();
    act(() => api!.setSortMode("date"));
    await settle();
    expect(await getPreference(SORT_PREF_KEY)).toBe("date");
    unmount();
    mount();
    await settle();
    expect(api!.sortMode).toBe("date");
  });
});

describe("library sort persistence", () => {
  it("starts at date (the server render) with nothing stored, once this browser has listened", async () => {
    mount();
    expect(api!.sortMode).toBe("date");
    await settle();
    expect(api!.sortMode).toBe("date");
  });

  it("a chosen sort survives a remount", async () => {
    mount();
    await settle();
    act(() => api!.setSortMode("date-asc"));
    await settle();
    expect(await getPreference(SORT_PREF_KEY)).toBe("date-asc");
    unmount();

    mount();
    // First render is the SSR-safe default; the stored sort arrives after mount.
    expect(api!.sortMode).toBe("date");
    await settle();
    expect(api!.sortMode).toBe("date-asc");
  });

  it("an explicit choice made before the stored value arrives wins over it", async () => {
    mount();
    await settle();
    act(() => api!.setSortMode("rated"));
    await settle();
    unmount();

    mount();
    // e.g. a ?sort= intent applied on mount, before IndexedDB answers.
    act(() => api!.setSortMode("guest"));
    await settle();
    expect(api!.sortMode).toBe("guest");
  });

  it("ignores a stored value that is not a sort mode", async () => {
    await db.userPrefs.add({ key: SORT_PREF_KEY, value: "sideways" });
    mount();
    await settle();
    expect(api!.sortMode).toBe("date");
  });
});
