import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A `?sort=` intent against a remembered sort, on the real /library page and
 * a real (fake-indexeddb) Dexie. Two features meet here: the rail branch
 * remembers the visitor's sort in UserPrefs and restores it after mount, and
 * HD-013 carries a sort in the URL. The URL is the visitor's newest choice, so
 * it must win whichever of the two resolves first — and be remembered in turn.
 *
 * Observed as a visitor would: the order of the rows on screen, and what is
 * stored for next time. The three shows are chosen so that newest-first,
 * oldest-first and by-name are three different orders.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));
vi.mock("@/audio/cache", () => ({
  removeCachedAudio: () => Promise.resolve(),
  isOPFSSupported: () => false,
}));

const { db, getPreference, setPreference } = await import("@/db");
const { SORT_PREF_KEY } = await import("@/hooks/library/useLibraryFilters");
const { default: LibraryPage } = await import("@/app/(desktop)/library/page");

// Air dates run in this order, so: oldest first = as listed, newest first =
// reversed, by name = Hoagland, Men, Whitley.
const SHOWS = [
  ["Men in Black", "1997-07-01"],
  ["Whitley Strieber", "1997-08-01"],
  ["Hoagland on Mars", "1997-09-01"],
] as const;

let root: Root;
let container: HTMLDivElement;

async function seed() {
  for (const [title, airDate] of SHOWS) {
    await db.episodes.add({
      fileHash: `archive:coll:${airDate}.mp3`,
      filePath: "",
      fileName: `${airDate}.mp3`,
      fileSize: 0,
      title,
      airDate,
      showType: "coast",
      source: "archive",
      createdAt: 0,
      updatedAt: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
}

/** Row titles top to bottom, by their slot's position in the virtual list. */
function rowTitles(): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
    .map((r) => ({ top: parseFloat((r.parentElement as HTMLElement).style.top || "0"), label: r.getAttribute("aria-label") ?? "" }))
    .sort((a, b) => a.top - b.top)
    .map((r) => r.label.replace(/, \d{4}-\d\d-\d\d.*$/, ""));
}

async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  if (!db.isOpen()) await db.open();
  await Promise.all([db.episodes.clear(), db.userPrefs.clear()]);
  await seed();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  search = "";
});

describe("?sort= against a remembered sort", () => {
  it("control: with no intent, the remembered oldest-first sort is restored", async () => {
    await setPreference(SORT_PREF_KEY, "date-asc");
    act(() => { root.render(createElement(LibraryPage)); });
    await settle();
    expect(rowTitles()).toEqual(["Men in Black", "Whitley Strieber", "Hoagland on Mars"]);
  });

  it("?sort=name wins over a stored date-asc, and is remembered in its place", async () => {
    await setPreference(SORT_PREF_KEY, "date-asc");
    search = "sort=name";
    act(() => { root.render(createElement(LibraryPage)); });
    await settle();
    expect(rowTitles()).toEqual(["Hoagland on Mars", "Men in Black", "Whitley Strieber"]);
    expect(await getPreference(SORT_PREF_KEY)).toBe("name");
  });
});
