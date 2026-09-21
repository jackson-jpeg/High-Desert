import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";
import type { LibraryIntent } from "@/lib/library/intents";

/**
 * The library's side of HD-013: reading an intent from the URL, applying it
 * once the data it needs exists, and owning `/`, Ctrl/Cmd+F and Q only while
 * the library is mounted. These mount the real reader and hooks; only the
 * router is a fake.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(search),
}));

const { LibraryIntentReader } = await import("@/components/library/LibraryIntentReader");
const { useLibraryIntents } = await import("@/hooks/library/useLibraryIntents");
const { useLibrarySearchShortcuts } = await import("@/hooks/library/useLibrarySearchShortcuts");

let root: Root | null = null;
let container: HTMLDivElement;

function render(node: React.ReactNode) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root!.render(node));
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
});

const ep = (id: number, showType: Episode["showType"] = "coast") =>
  ({ id, title: `Show ${id}`, fileName: `${id}.mp3`, fileHash: `archive:x:${id}.mp3`, showType } as Episode);

describe("LibraryIntentReader", () => {
  it("hands over the intent and clears it from the URL, without a history entry", () => {
    const onIntent = vi.fn();
    search = "shuffle=coast&sort=played";
    render(createElement(LibraryIntentReader, { onIntent }));
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({ shuffle: "coast", sort: "played" } satisfies LibraryIntent);
    expect(replace).toHaveBeenCalledWith("/library", { scroll: false });
  });

  it("clears an invalid intent without acting on it", () => {
    const onIntent = vi.fn();
    search = "shuffle=everything";
    render(createElement(LibraryIntentReader, { onIntent }));
    expect(onIntent).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/library", { scroll: false });
  });

  it("leaves a URL with no intent alone", () => {
    const onIntent = vi.fn();
    search = "viewer";
    render(createElement(LibraryIntentReader, { onIntent }));
    expect(onIntent).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("acts once under StrictMode's double effect, and again when the same intent comes back", () => {
    const onIntent = vi.fn();
    search = "shuffle=dreamland";
    render(createElement(StrictMode, null, createElement(LibraryIntentReader, { onIntent })));
    expect(onIntent).toHaveBeenCalledTimes(1);
    // The replace lands: the params are gone.
    search = "";
    render(createElement(StrictMode, null, createElement(LibraryIntentReader, { onIntent })));
    expect(onIntent).toHaveBeenCalledTimes(1);
    // A second "Shuffle Dreamland" from the menu, on an already-mounted library.
    search = "shuffle=dreamland";
    render(createElement(StrictMode, null, createElement(LibraryIntentReader, { onIntent })));
    expect(onIntent).toHaveBeenCalledTimes(2);
  });
});

type IntentsProps = Parameters<typeof useLibraryIntents>[0];

function mountIntents(initial: Partial<IntentsProps> = {}) {
  let api: ReturnType<typeof useLibraryIntents> | null = null;
  const props: IntentsProps = {
    allEpisodes: undefined,
    visibleEpisodes: [],
    seedSettled: false,
    currentEpisodeId: undefined,
    setSortMode: vi.fn(),
    setSearch: vi.fn(),
    setSelectedEpisode: vi.fn(),
    setFocusedIndex: vi.fn(),
    onShuffle: vi.fn(),
    ...initial,
  };
  const capture = (a: ReturnType<typeof useLibraryIntents>) => { api = a; };
  function Probe({ onApi, ...p }: IntentsProps & { onApi: typeof capture }) {
    onApi(useLibraryIntents(p));
    return null;
  }
  const update = (next: Partial<IntentsProps>) => {
    Object.assign(props, next);
    render(createElement(Probe, { ...props, onApi: capture }));
  };
  update({});
  return { props, update, apply: (i: LibraryIntent) => act(() => api!.applyIntent(i)), api: () => api! };
}

describe("useLibraryIntents", () => {
  it("applies sort and search at once, and deselects for a search", () => {
    const m = mountIntents();
    m.apply({ sort: "guest", q: "tag:ufo" });
    expect(m.props.setSortMode).toHaveBeenCalledWith("guest");
    expect(m.props.setSearch).toHaveBeenCalledWith("tag:ufo");
    expect(m.props.setSelectedEpisode).toHaveBeenCalledWith(null);
    expect(m.props.onShuffle).not.toHaveBeenCalled();
  });

  it("holds a shuffle until the catalog has loaded, then shuffles exactly once", () => {
    const m = mountIntents();
    m.apply({ shuffle: "coast" });
    expect(m.props.onShuffle).not.toHaveBeenCalled();
    // Live query resolved, but seeding has not: an empty table is ambiguous.
    m.update({ allEpisodes: [] });
    expect(m.props.onShuffle).not.toHaveBeenCalled();
    const all = [ep(1), ep(2, "dreamland")];
    m.update({ allEpisodes: all, visibleEpisodes: all });
    expect(m.props.onShuffle).toHaveBeenCalledTimes(1);
    expect(m.props.onShuffle).toHaveBeenCalledWith("coast");
    m.update({ allEpisodes: [...all], seedSettled: true });
    expect(m.props.onShuffle).toHaveBeenCalledTimes(1);
  });

  it("lets a shuffle on an empty, settled library answer rather than wait forever", () => {
    const m = mountIntents({ allEpisodes: [] });
    m.apply({ shuffle: "all" });
    expect(m.props.onShuffle).not.toHaveBeenCalled();
    m.update({ seedSettled: true });
    expect(m.props.onShuffle).toHaveBeenCalledWith("all");
  });

  it("scrolls to the playing show once the list has rows, and selects it", () => {
    const list = [ep(1), ep(2), ep(3)];
    const m = mountIntents({ currentEpisodeId: 3 });
    m.apply({ scroll: "current" });
    expect(m.props.setFocusedIndex).not.toHaveBeenCalled();
    m.update({ allEpisodes: list, visibleEpisodes: list });
    expect(m.props.setSelectedEpisode).toHaveBeenCalledWith(list[2]);
    expect(m.props.setFocusedIndex).toHaveBeenCalledWith(2);
    m.update({ visibleEpisodes: [...list] });
    expect(m.props.setFocusedIndex).toHaveBeenCalledTimes(1);
  });

  it("scrollToCurrent is callable directly (the floating now-playing button)", () => {
    const list = [ep(1), ep(2)];
    const m = mountIntents({ allEpisodes: list, visibleEpisodes: list, currentEpisodeId: 2 });
    act(() => m.api().scrollToCurrent());
    expect(m.props.setFocusedIndex).toHaveBeenCalledWith(1);
  });
});

describe("useLibrarySearchShortcuts", () => {
  function mountShortcuts() {
    const focusSearch = vi.fn();
    const queueSelected = vi.fn();
    function Probe() {
      useLibrarySearchShortcuts({ focusSearch, queueSelected });
      return null;
    }
    render(createElement(Probe));
    return { focusSearch, queueSelected };
  }

  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it("/ and Ctrl/Cmd+F focus the search box, Q queues the selection", () => {
    const s = mountShortcuts();
    expect(press({ code: "Slash", key: "/" }).defaultPrevented).toBe(true);
    expect(press({ code: "KeyF", key: "f", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ code: "KeyF", key: "f", metaKey: true }).defaultPrevented).toBe(true);
    expect(s.focusSearch).toHaveBeenCalledTimes(3);
    expect(press({ code: "KeyQ", key: "q" }).defaultPrevented).toBe(true);
    expect(s.queueSelected).toHaveBeenCalledTimes(1);
  });

  it("leaves ? , a bare F and keys typed into a field alone", () => {
    const s = mountShortcuts();
    expect(press({ code: "Slash", key: "?", shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ code: "KeyF", key: "f" }).defaultPrevented).toBe(false);
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(press({ code: "KeyF", key: "f", ctrlKey: true }, input).defaultPrevented).toBe(false);
    expect(press({ code: "KeyQ", key: "q" }, input).defaultPrevented).toBe(false);
    input.remove();
    expect(s.focusSearch).not.toHaveBeenCalled();
    expect(s.queueSelected).not.toHaveBeenCalled();
  });

  it("gives the browser its find back once the library unmounts (HD-013)", () => {
    const s = mountShortcuts();
    act(() => root!.unmount());
    root = null;
    expect(press({ code: "KeyF", key: "f", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press({ code: "Slash", key: "/" }).defaultPrevented).toBe(false);
    expect(s.focusSearch).not.toHaveBeenCalled();
  });
});
