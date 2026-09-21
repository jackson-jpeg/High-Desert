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
});
afterEach(() => {
  if (api) unmount();
});

describe("library sort persistence", () => {
  it("starts at date (the server render) with nothing stored", async () => {
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
