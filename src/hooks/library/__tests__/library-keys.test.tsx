import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * HD-011, on the real /library page against a real (fake-indexeddb) Dexie.
 *
 * The page is mounted whole — keyboard hook, actions hook, detail panel,
 * confirmation dialog — because the defects were in how those pieces were
 * wired to each other, not in any one of them:
 *
 * - Enter on a focused button played the selected episode instead of
 *   pressing the button. That includes the Delete button in the delete
 *   confirmation, so "Enter to confirm" played the show behind the dialog.
 * - In admin mode Backspace/Delete deleted the selected episode immediately,
 *   no confirmation, even with focus on a button.
 *
 * jsdom performs no default actions, so "the button is activated" is observed
 * the way a browser decides it: the keydown reaches the button and nobody
 * called `preventDefault()`. The e2e spec (e2e/keys.spec.ts) presses a real
 * key in Chromium. Deletion is asserted on the stored rows, never on a mock.
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
const { useAdminStore } = await import("@/stores/admin-store");
const { default: LibraryPage } = await import("@/app/(desktop)/library/page");

let root: Root;
let container: HTMLDivElement;
let plays: string[];
const onPlayEvent = (e: Event) => {
  plays.push(((e as CustomEvent).detail as { title?: string })?.title ?? "?");
};

const TITLES = ["Men in Black", "Whitley Strieber", "Hoagland on Mars"];

async function seed(): Promise<number[]> {
  const ids: number[] = [];
  for (const [i, title] of TITLES.entries()) {
    ids.push((await db.episodes.add({
      fileHash: `archive:coll:1997-0${i + 7}-01.mp3`,
      filePath: "",
      fileName: `1997-0${i + 7}-01.mp3`,
      fileSize: 0,
      title,
      airDate: `1997-0${i + 7}-01`,
      showType: "coast",
      source: "archive",
      createdAt: 0,
      updatedAt: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as number);
  }
  return ids;
}

async function waitFor<T>(find: () => T | null | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const got = find();
    if (got) return got;
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

/** Dispatch a keydown on `el` the way a browser would; returns defaultPrevented. */
function press(el: Element, code: string, key = code): boolean {
  const ev = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev.defaultPrevented;
}

function row(title: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
    .find((r) => r.getAttribute("aria-label")?.startsWith(title)) ?? null;
}

function confirmDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function buttonIn(scope: ParentNode, text: string): HTMLButtonElement | null {
  return Array.from(scope.querySelectorAll("button"))
    .find((b) => b.textContent?.trim() === text) ?? null;
}

async function mountAndSelect(title: string) {
  act(() => { root.render(createElement(LibraryPage)); });
  const r = await waitFor(() => row(title), `row "${title}"`);
  act(() => { r.click(); });
  // The detail panel opens on the selected episode.
  await waitFor(() => container.querySelector('[aria-selected="true"]'), "selection");
  return r;
}

beforeEach(async () => {
  plays = [];
  window.addEventListener("hd:play-episode", onPlayEvent);
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  if (!db.isOpen()) await db.open();
  await Promise.all([db.episodes.clear(), db.history.clear(), db.bookmarks.clear(), db.playlists.clear(), db.userPrefs.clear()]);
  useAdminStore.setState({ isAdmin: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener("hd:play-episode", onPlayEvent);
  vi.unstubAllGlobals();
});

describe("library keyboard — keys a focused control owns", () => {
  it("control: Enter on the selected row plays it", async () => {
    // Without this, "Enter did not play" below is not evidence: a page whose
    // keyboard handler never mounted would pass every other test here.
    await seed();
    const r = await mountAndSelect("Whitley Strieber");
    expect(press(r, "Enter")).toBe(true);
    expect(plays).toEqual(["Whitley Strieber"]);
  });

  it("Enter on a focused button in the detail panel is the button's, not play", async () => {
    await seed();
    await mountAndSelect("Whitley Strieber");
    const close = await waitFor(
      () => container.querySelector<HTMLButtonElement>('button[aria-label="Close detail"]'),
      "the detail panel's close button",
    );
    close.focus();
    expect(press(close, "Enter")).toBe(false);
    expect(press(close, "Space", " ")).toBe(false);
    expect(plays).toEqual([]);
  });

  it("Enter on a focused toolbar button is the button's, not play", async () => {
    await seed();
    await mountAndSelect("Whitley Strieber");
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle browse panel"]')!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(press(btn, "Enter")).toBe(false);
    expect(plays).toEqual([]);
  });

  it("Backspace on a focused button (admin) neither deletes nor opens the dialog", async () => {
    const ids = await seed();
    useAdminStore.setState({ isAdmin: true });
    await mountAndSelect("Whitley Strieber");
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Close detail"]')!;
    btn.focus();
    expect(press(btn, "Backspace")).toBe(false);
    await settle();
    expect(confirmDialog()).toBeNull();
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);
  });

  it("Shift+ArrowDown still moves the selection with a row's star button focused", async () => {
    // Chromium focuses a button on click, so this is the state right after
    // favouriting a row with the mouse. A button does nothing with an arrow.
    await seed();
    const r = await mountAndSelect("Whitley Strieber");
    const star = r.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(star).not.toBeNull();
    star.focus();
    expect(document.activeElement).toBe(star);
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true });
    act(() => { star.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    // The focus row starts at -1, so the first Shift+ArrowDown opens the
    // first row on screen — not the one that was clicked.
    const first = container.querySelector<HTMLElement>('[role="option"]')!;
    expect(first.getAttribute("aria-label")).not.toMatch(/^Whitley Strieber/);
    await waitFor(() => first.getAttribute("aria-selected") === "true", "the first row to be selected");
    expect(row("Whitley Strieber")!.getAttribute("aria-selected")).toBe("false");
    expect(plays).toEqual([]);
  });

  it("keys inside a menu are ignored by the library", async () => {
    const ids = await seed();
    useAdminStore.setState({ isAdmin: true });
    await mountAndSelect("Whitley Strieber");
    // The context menu and the menu bar are rendered by the shell, not the
    // page; a role="menu" host stands in for them.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.tabIndex = 0;
    menu.appendChild(item);
    document.body.appendChild(menu);
    try {
      expect(press(item, "Enter")).toBe(false);
      expect(press(item, "Backspace")).toBe(false);
      await settle();
    } finally {
      menu.remove();
    }
    expect(plays).toEqual([]);
    expect(confirmDialog()).toBeNull();
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);
  });
});

describe("library — every single delete is confirmed", () => {
  it("Backspace (admin, one selected) opens the confirmation and deletes nothing until confirmed; confirming deletes exactly that one", async () => {
    const ids = await seed();
    useAdminStore.setState({ isAdmin: true });
    const r = await mountAndSelect("Whitley Strieber");

    expect(press(r, "Backspace")).toBe(true);
    const dialog = await waitFor(confirmDialog, "the delete confirmation");
    expect(dialog.textContent).toContain("Delete 1 episode?");
    await settle();
    // Nothing deleted while the dialog is up.
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);

    // Keys inside the dialog belong to the dialog. Enter on its Delete button
    // must not play the episode behind it, and Backspace must not re-request.
    const del = buttonIn(dialog, "Delete")!;
    del.focus();
    expect(press(del, "Enter")).toBe(false);
    expect(press(dialog, "Backspace")).toBe(false);
    expect(plays).toEqual([]);
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);

    await act(async () => { del.click(); });
    await waitFor(() => !confirmDialog(), "the dialog to close");
    const left = await db.episodes.toArray();
    expect(left.map((e) => e.title).sort()).toEqual(["Hoagland on Mars", "Men in Black"]);
  });

  it("Cancel deletes nothing", async () => {
    const ids = await seed();
    useAdminStore.setState({ isAdmin: true });
    const r = await mountAndSelect("Men in Black");
    press(r, "Delete");
    const dialog = await waitFor(confirmDialog, "the delete confirmation");
    act(() => { buttonIn(dialog, "Cancel")!.click(); });
    await settle();
    expect(confirmDialog()).toBeNull();
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);
  });

  it("the detail panel's Delete opens the confirmation instead of deleting", async () => {
    const ids = await seed();
    useAdminStore.setState({ isAdmin: true });
    await mountAndSelect("Hoagland on Mars");
    const del = await waitFor(() => buttonIn(container, "Delete"), "the panel's Delete button");
    await act(async () => { del.click(); });
    const dialog = await waitFor(confirmDialog, "the delete confirmation");
    await settle();
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);
    await act(async () => { buttonIn(dialog, "Delete")!.click(); });
    await waitFor(() => !confirmDialog(), "the dialog to close");
    expect((await db.episodes.toArray()).map((e) => e.title).sort()).toEqual(["Men in Black", "Whitley Strieber"]);
  });

  it("the row context menu's Delete opens the confirmation instead of deleting", async () => {
    const ids = await seed();
    useAdminStore.setState({ isAdmin: true });
    const r = await mountAndSelect("Men in Black");
    act(() => {
      r.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });
    const { useContextMenuStore } = await import("@/stores/context-menu-store");
    const item = useContextMenuStore.getState().items.find((i) => i.label === "Delete");
    expect(item).toBeDefined();
    await act(async () => { await item!.onClick(); });
    await waitFor(confirmDialog, "the delete confirmation");
    await settle();
    expect((await db.episodes.toArray()).map((e) => e.id)).toEqual(ids);
  });
});
