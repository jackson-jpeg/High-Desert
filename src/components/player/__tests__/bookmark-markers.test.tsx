import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeMediaElement, setReadyState } from "@/hooks/__tests__/support/mount-player";

/**
 * HD-012: a bookmark marker must move the playhead.
 *
 * It used to set `document.querySelector("audio").currentTime`. The player is
 * a detached `new Audio()` that is never in the DOM, so the lookup found
 * nothing, and only the store's `position` changed — which the next 250 ms tick
 * overwrote with where the element really was. There is no <audio> in the DOM
 * here, as in production, and the assertion is on the engine's element.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { db } = await import("@/db");
const { initEngine } = await import("@/audio/engine");
const { usePlayerStore } = await import("@/stores/player-store");
const { BookmarkMarkers } = await import("@/components/player/BookmarkMarkers");

let root: Root;
let container: HTMLDivElement;
let element: HTMLAudioElement;

beforeEach(async () => {
  await db.bookmarks.clear();
  element = makeMediaElement();
  Object.defineProperty(element, "duration", { value: 10_800, configurable: true });
  setReadyState(element, 4);
  initEngine(element);
  usePlayerStore.setState({
    currentEpisode: { id: 42 } as never,
    duration: 10_800,
    position: 0,
  });
  await db.bookmarks.add({ episodeId: 42, position: 5_400, label: "Area 51 caller", createdAt: 0 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderMarkers(): Promise<HTMLButtonElement> {
  act(() => {
    root.render(createElement(BookmarkMarkers, { mode: "markers" }));
  });
  // useLiveQuery resolves asynchronously against IndexedDB.
  for (let i = 0; i < 50; i++) {
    const btn = container.querySelector("button");
    if (btn) return btn as HTMLButtonElement;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error("marker never rendered");
}

describe("bookmark markers", () => {
  it("clicking a marker moves the engine element's playhead, not just the store", async () => {
    const marker = await renderMarkers();
    expect(document.querySelector("audio")).toBeNull(); // as in production

    act(() => {
      marker.click();
    });

    expect(element.currentTime).toBe(5_400);
    expect(usePlayerStore.getState().position).toBe(5_400);
  });
});
