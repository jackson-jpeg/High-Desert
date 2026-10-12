import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LibraryIntent } from "@/lib/library/intents";

/**
 * `/library?view=dial` reaches the page's List / Dial state through the real
 * reader and the real useLibraryIntents (HD-013's one path). Whether the look
 * has a dial at all is useLibraryView's to decide (library-dial.test.tsx).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let search = "";
vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(search),
}));

const { LibraryIntentReader } = await import("@/components/library/LibraryIntentReader");
const { useLibraryIntents } = await import("@/hooks/library/useLibraryIntents");

let root: Root;
let container: HTMLDivElement;
const setView = vi.fn();
const setSortMode = vi.fn();

function Page() {
  const { applyIntent } = useLibraryIntents({
    allEpisodes: [],
    visibleEpisodes: [],
    seedSettled: true,
    currentEpisodeId: undefined,
    setSortMode,
    setSearch: vi.fn(),
    setSelectedEpisode: vi.fn(),
    setFocusedIndex: vi.fn(),
    onShuffle: vi.fn(),
    setView,
  });
  return createElement(LibraryIntentReader, { onIntent: (i: LibraryIntent) => applyIntent(i) });
}

beforeEach(() => {
  setView.mockClear();
  setSortMode.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the view intent, applied", () => {
  it("?view=dial asks the page for the dial", () => {
    search = "view=dial";
    act(() => root.render(createElement(Page)));
    expect(setView).toHaveBeenCalledWith("dial");
  });

  it("?view=list asks for the list, beside another intent", () => {
    search = "view=list&sort=name";
    act(() => root.render(createElement(Page)));
    expect(setView).toHaveBeenCalledWith("list");
    expect(setSortMode).toHaveBeenCalledWith("name");
  });

  it("an invalid view changes nothing (control: the reader ran)", () => {
    search = "view=radio&sort=name";
    act(() => root.render(createElement(Page)));
    expect(setSortMode).toHaveBeenCalledWith("name");
    expect(setView).not.toHaveBeenCalled();
  });
});
