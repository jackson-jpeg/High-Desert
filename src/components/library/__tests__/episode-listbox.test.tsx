import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onHdEvent } from "@/lib/events";
import type { Episode } from "@/db/schema";

/**
 * HD-021: the episode list as a listbox, on the real /library page against a
 * real (fake-indexeddb) Dexie — the keyboard hook, the selection hook and the
 * virtualised TimelineView wired together as they ship, because the
 * semantics live in how they agree: the row the arrows move to must be the
 * row `aria-activedescendant` names, and that row must be in the DOM.
 *
 * Everything is read off the rendered DOM — roles, ids, aria-* attributes —
 * the way assistive technology reads it. The e2e spec (e2e/listbox.spec.ts)
 * presses the same keys in Chromium, with real layout and scrolling.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));
vi.mock("@/audio/cache", () => ({
  removeCachedAudio: () => Promise.resolve(),
  isOPFSSupported: () => false,
}));

const { db } = await import("@/db");
const { usePlayerStore } = await import("@/stores/player-store");
const { default: LibraryPage } = await import("@/app/(desktop)/library/page");

/** Enough rows that the virtual list renders only a window of them. */
const COUNT = 60;

let root: Root;
let container: HTMLDivElement;
let plays: string[];
let offPlay = () => {};

/** Newest first is the default sort, so row i is "Show i" (1-based, as seeded). */
async function seed(): Promise<void> {
  const rows = [];
  for (let i = 1; i <= COUNT; i++) {
    const day = new Date(Date.UTC(2000, 0, 1) - i * 86_400_000).toISOString().slice(0, 10);
    rows.push({
      fileHash: `archive:coll:${i}.mp3`,
      filePath: "",
      fileName: `${i}.mp3`,
      fileSize: 0,
      title: `Show ${i}`,
      airDate: day,
      showType: "coast",
      source: "archive",
      createdAt: 0,
      updatedAt: 0,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.episodes.bulkAdd(rows as any);
}

async function waitFor<T>(find: () => T | null | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const got = find();
    if (got) return got;
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  throw new Error(`timed out waiting for ${what}`);
}

function listbox(): HTMLElement {
  const lb = container.querySelector<HTMLElement>('[role="listbox"][aria-label="Episodes"]');
  if (!lb) throw new Error("no episode listbox");
  return lb;
}

function options(): HTMLElement[] {
  return Array.from(listbox().querySelectorAll<HTMLElement>('[role="option"]'));
}

function titleOf(el: Element | null): string | null {
  return el?.getAttribute("aria-label")?.split(",")[0] ?? null;
}

/** The option `aria-activedescendant` names — null if it names nothing in the DOM. */
function active(): HTMLElement | null {
  const id = listbox().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

function press(el: Element, code: string, init: KeyboardEventInit = {}): boolean {
  const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev.defaultPrevented;
}

async function mount() {
  await seed();
  act(() => { root.render(createElement(LibraryPage)); });
  await waitFor(() => container.querySelector('[role="option"]'), "the first row");
  const lb = listbox();
  // jsdom has no layout: give the scroller the height a real one would have,
  // so "is the active row in view" means something.
  Object.defineProperty(lb.parentElement!, "clientHeight", { configurable: true, value: 340 });
  lb.focus();
  return lb;
}

beforeEach(async () => {
  plays = [];
  offPlay = onHdEvent("play-episode", (ep: Episode) => { plays.push(ep?.title ?? "?"); });
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  if (!db.isOpen()) await db.open();
  await Promise.all([db.episodes.clear(), db.history.clear(), db.bookmarks.clear(), db.playlists.clear(), db.userPrefs.clear()]);
  usePlayerStore.setState({ currentEpisode: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  offPlay();
  vi.unstubAllGlobals();
});

// Each test mounts the whole page over 60 rows and walks it key by key; under
// the full suite's load that ran past vitest's 5s default.
describe("the episode list is a listbox (HD-021)", { timeout: 30_000 }, () => {
  it("is a focusable listbox; the rows are not tab stops", async () => {
    const lb = await mount();
    expect(lb.tabIndex).toBe(0);
    expect(document.activeElement).toBe(lb);
    for (const o of options()) {
      expect(o.hasAttribute("tabindex"), `${titleOf(o)} has a tabindex`).toBe(false);
      expect(o.querySelector("button, [tabindex], a[href]"), `${titleOf(o)} nests a control`).toBeNull();
    }
  });

  it("every rendered row carries the whole list's size and its own 1-based place in it", async () => {
    await mount();
    const rendered = options();
    // Virtualised: a window, not the list — which is why the counts matter.
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.length).toBeLessThan(COUNT);
    for (const o of rendered) {
      expect(o.getAttribute("aria-setsize")).toBe(String(COUNT));
      // Seeded newest first as "Show 1".."Show 60", so the title is the place.
      expect(o.getAttribute("aria-posinset")).toBe(titleOf(o)!.replace("Show ", ""));
    }
  });

  it("plain ArrowDown in the list moves the active row, and aria-activedescendant follows", async () => {
    const lb = await mount();
    expect(lb.hasAttribute("aria-activedescendant")).toBe(false);

    expect(press(lb, "ArrowDown")).toBe(true);
    await waitFor(() => titleOf(active()) === "Show 1", "the first row to become active");
    const first = lb.getAttribute("aria-activedescendant");

    expect(press(lb, "ArrowDown")).toBe(true);
    await waitFor(() => titleOf(active()) === "Show 2", "the second row to become active");
    expect(lb.getAttribute("aria-activedescendant")).not.toBe(first);
    // Selection follows focus: the active row is the selected one.
    expect(active()!.getAttribute("aria-selected")).toBe("true");

    expect(press(lb, "ArrowUp")).toBe(true);
    await waitFor(() => titleOf(active()) === "Show 1", "ArrowUp to move back");

    expect(press(lb, "Enter")).toBe(true);
    expect(plays).toEqual(["Show 1"]);
  });

  it("plain arrows outside the list are left alone (control: Shift+ArrowDown still works there)", async () => {
    await mount();
    expect(press(document.body, "ArrowDown")).toBe(false);
    expect(listbox().hasAttribute("aria-activedescendant")).toBe(false);
    expect(press(document.body, "ArrowDown", { shiftKey: true })).toBe(true);
    await waitFor(() => titleOf(active()) === "Show 1", "Shift+ArrowDown to move from the page");
  });

  it("the active row stays rendered as the arrows walk past the virtual window; Home and End jump", async () => {
    const lb = await mount();
    const scroller = lb.parentElement!;
    for (let i = 0; i < 40; i++) press(lb, "ArrowDown");
    // Row 40 was never in the first window (~340px of 34px rows plus overscan).
    await waitFor(() => titleOf(active()) === "Show 40", "row 40 to be active and in the DOM");
    expect(scroller.scrollTop).toBeGreaterThan(0);

    press(lb, "End");
    await waitFor(() => titleOf(active()) === `Show ${COUNT}`, "End to reach the last row");
    press(lb, "Home");
    await waitFor(() => titleOf(active()) === "Show 1", "Home to reach the first row");
    expect(scroller.scrollTop).toBe(0);
  });

  it("aria-selected is true on exactly one row — the selected one, not also the playing one", async () => {
    const lb = await mount();
    const playing = (await db.episodes.toArray()).find((e) => e.title === "Show 3")!;
    act(() => usePlayerStore.setState({ currentEpisode: playing }));
    press(lb, "ArrowDown");
    await waitFor(() => titleOf(active()) === "Show 1", "the first row to be selected");

    const selected = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected.map(titleOf)).toEqual(["Show 1"]);
    const playingRow = options().find((o) => titleOf(o) === "Show 3")!;
    expect(playingRow.getAttribute("aria-label")).toMatch(/\(now playing\)$/);
    expect(playingRow.getAttribute("aria-selected")).toBe("false");
  });

  it("a clicked row becomes the active row; the arrows continue from it", async () => {
    const lb = await mount();
    const row = options().find((o) => titleOf(o) === "Show 5")!;
    act(() => { row.click(); });
    await waitFor(() => titleOf(active()) === "Show 5", "the clicked row to be active");
    press(lb, "ArrowDown");
    await waitFor(() => titleOf(active()) === "Show 6", "ArrowDown from the clicked row");
  });
});
