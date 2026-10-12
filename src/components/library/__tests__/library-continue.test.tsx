import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onHdEvent } from "@/lib/events";
import type { Episode } from "@/db/schema";

/**
 * Continue listening, front and centre, on the real /library page against a
 * real (fake-indexeddb) Dexie: at the top, above the list, and its tap is the
 * library's own play (the `play-episode` bus), which starts at the saved
 * second. The card's own rules are in continue-listening.test.tsx.
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
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => mobile.value,
  useMediaQuery: () => mobile.value,
}));
vi.mock("@/audio/cache", () => ({
  removeCachedAudio: () => Promise.resolve(),
  isOPFSSupported: () => false,
}));

const { db } = await import("@/db");
const { usePlayerStore } = await import("@/stores/player-store");
const { default: LibraryPage } = await import("@/app/[look]/(desktop)/library/page");

let root: Root;
let container: HTMLDivElement;
let plays: Episode[];
let offPlay = () => {};

async function seed() {
  const rows = [
    { title: "Men in Black", date: "1997-07-01", position: 1800 },
    { title: "Whitley Strieber", date: "1997-08-01", position: null },
  ];
  for (const [i, r] of rows.entries()) {
    const fileHash = `archive:coll:${r.date}.mp3`;
    await db.episodes.add({
      fileHash,
      filePath: "",
      fileName: `${r.date}.mp3`,
      fileSize: 0,
      title: r.title,
      airDate: r.date,
      duration: 10800,
      showType: "coast",
      source: "archive",
      createdAt: 0,
      updatedAt: 0,
    } as never);
    if (r.position !== null) await db.progress.put({ fileHash, playbackPosition: r.position, lastPlayedAt: 1000 + i });
  }
}

async function waitFor<T>(find: () => T | null | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const got = find();
    if (got) return got;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeEach(async () => {
  plays = [];
  offPlay = onHdEvent("play-episode", (ep) => plays.push(ep));
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  if (!db.isOpen()) await db.open();
  await Promise.all([db.episodes.clear(), db.progress.clear(), db.history.clear(), db.userPrefs.clear()]);
  usePlayerStore.setState({ currentEpisode: null });
  mobile.value = false;
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

for (const phone of [false, true]) {
  describe(`the Library's Continue listening (${phone ? "phone" : "desktop"})`, () => {
    it("sits above the list, and one tap plays the show through the library's play", async () => {
      mobile.value = phone;
      await seed();
      act(() => root.render(createElement(LibraryPage)));
      const card = await waitFor(() => container.querySelector<HTMLElement>('[data-testid="continue-listening"]'), "the card");
      const list = await waitFor(() => container.querySelector<HTMLElement>('[role="listbox"]'), "the list");
      // Front and centre: before the list in the page, not inside the collapsed discovery band.
      expect(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(card.closest("details")).toBeNull();
      const resume = card.querySelector<HTMLButtonElement>('[data-testid="continue-resume"]')!;
      expect(resume.getAttribute("aria-label")).toBe("Resume Men in Black at 30:00");
      act(() => resume.click());
      expect(plays.map((p) => p.title)).toEqual(["Men in Black"]);
    });
  });
}

describe("the Library's Continue listening, with that show in the player", () => {
  it("leaves out the show already in the player: the player is how to go on with it", async () => {
    await seed();
    const ep = await db.episodes.where("fileHash").equals("archive:coll:1997-07-01.mp3").first();
    usePlayerStore.setState({ currentEpisode: ep as Episode });
    act(() => root.render(createElement(LibraryPage)));
    await waitFor(() => container.querySelector('[role="listbox"]'), "the list");
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(container.querySelector('[data-testid="continue-listening"]')).toBeNull();
  });
});
