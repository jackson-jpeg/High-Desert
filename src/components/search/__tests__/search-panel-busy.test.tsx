import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchiveSearchResult } from "@/services/archive/types";

/**
 * The results area says it is busy until the search has answered. /search
 * searches on mount and its cards fade in when the answer lands, on the
 * network's timer; e2e/a11y.spec.ts waits for `aria-busy="false"` before it
 * scans, because axe once measured those cards mid-fade (CI, 2026-09-28) and
 * reported their buttons at 1.29:1.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
  query: "",
  results: [] as ArchiveSearchResult[],
  totalResults: 0,
  page: 1,
  loading: false,
  error: null as string | null,
  addingIds: new Set<string>(),
  addedIds: new Set<string>(),
  // As the real one (src/hooks/useArchiveSearch.ts): loading at once.
  search: vi.fn(() => {
    state.loading = true;
  }),
  addToLibrary: vi.fn(),
  addAllToLibrary: vi.fn(),
};
vi.mock("@/hooks/useArchiveSearch", () => ({ useArchiveSearch: () => state }));

const { SearchPanel } = await import("../SearchPanel");

let host: HTMLDivElement;
let root: Root;

function mount() {
  act(() => root.render(<SearchPanel />));
}
const busy = () => host.querySelector("[data-search-results]")?.getAttribute("aria-busy");

beforeEach(() => {
  Object.assign(state, { query: "", results: [], totalResults: 0, loading: false, error: null });
  state.search.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("SearchPanel's results area", () => {
  it("is busy while the search is loading", () => {
    state.loading = true;
    state.query = "Art Bell";
    mount();
    expect(busy()).toBe("true");
  });

  it("is busy on first paint, before the search on mount has even started", () => {
    // The mount effect starts the search; until it answers there is nothing to read.
    mount();
    expect(state.search).toHaveBeenCalledWith("Art Bell");
    expect(busy()).toBe("true");
  });

  it("is not busy once results have arrived", () => {
    state.query = "Art Bell";
    state.results = [{ identifier: "x", title: "A show", date: "1997-03-13", downloads: 3 } as ArchiveSearchResult];
    state.totalResults = 1;
    mount();
    expect(busy()).toBe("false");
    expect(host.textContent).toContain("A show");
  });

  it("is not busy when the search answered with nothing", () => {
    mount();
    expect(busy()).toBe("true");
    Object.assign(state, { query: "zzz", loading: false });
    mount();
    expect(busy()).toBe("false");
    expect(host.textContent).toContain("No results");
  });
});
