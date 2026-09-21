import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * The real EpisodeDetail, mounted against a real (fake-indexeddb) Dexie: a
 * render smoke test for the panel after its HD-018 split into sibling
 * sections. Only the network is stubbed — the community-ratings fetch — and
 * it answers the way the route does.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { db } = await import("@/db");
const { EpisodeDetail } = await import("@/components/library/EpisodeDetail");

const EPISODE: Episode = {
  id: 1,
  fileHash: "archive:coll:1997-03-13 Show.mp3",
  fileName: "1997-03-13 Show.mp3",
  archiveIdentifier: "coll",
  source: "archive",
  title: "Phoenix Lights",
  guestName: "Ed Dames",
  airDate: "1997-03-13",
  duration: 3 * 3600,
  showType: "coast",
  aiSummary: "Lights over Arizona.",
  aiTags: ["ufo", "arizona"],
  aiCategory: "UFOs & Aliens",
  aiSeries: "Lights",
  aiSeriesPart: 1,
  playbackPosition: 1800,
  playCount: 2,
  rating: 4,
} as Episode;

let root: Root;
let host: HTMLDivElement;

async function flush() {
  // Live queries and the ratings fetch each settle over a few ticks.
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

beforeEach(async () => {
  await db.episodes.clear();
  await db.bookmarks.clear();
  await db.episodes.bulkAdd([
    EPISODE,
    { ...EPISODE, id: 2, fileHash: "archive:coll:p2.mp3", fileName: "p2.mp3", title: "Phoenix Lights II", aiSeriesPart: 2 } as Episode,
  ]);
  await db.bookmarks.add({ episodeId: 1, position: 600, label: "The sighting", createdAt: 1 });

  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/stats/ratings")) {
      return new Response(JSON.stringify({ "coll--1997-03-13_Show": { avg: 4.5, count: 12 } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }));

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(props: Partial<Parameters<typeof EpisodeDetail>[0]> = {}) {
  act(() => {
    root.render(createElement(EpisodeDetail, {
      episode: EPISODE,
      isPlaying: false,
      onPlay: () => {},
      onClose: () => {},
      communityPlays: 42,
      ...props,
    }));
  });
}

const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("EpisodeDetail", () => {
  it("renders the episode's key fields and every section", async () => {
    render({ onEdit: () => {}, onDelete: () => {}, onToggleFavorite: () => {} });
    await flush();

    // Header
    expect(text()).toContain("UFOs & Aliens");
    expect(host.querySelector('[aria-label="Close detail"]')).not.toBeNull();
    // Overview
    expect(text()).toContain("Phoenix Lights");
    expect(text()).toContain("Ed Dames");
    expect(text()).toContain("Mar 13, 1997");
    expect(text()).toContain("3h 0m");
    expect(text()).toContain("42 community plays");
    expect(text()).toContain("Lights over Arizona.");
    expect(button("ufo")).toBeDefined();
    expect(button("arizona")).toBeDefined();
    // Bookmarks, from Dexie
    expect(text()).toContain("The sighting");
    // Progress and play stats
    expect(text()).toContain("30:00 / 3h 0m");
    expect(text()).toContain("Played 2x");
    expect(text()).toContain("17% heard");
    // Play controls and rating (community average from the stubbed route)
    expect(button("▶ Play")).toBeDefined();
    expect(button("Queue")).toBeDefined();
    expect(text()).toContain("4/5");
    expect(text()).toContain("4.5 avg · 12");
    // Manage bar
    const archive = host.querySelector('a[href^="https://archive.org/details/coll/"]');
    expect(archive).not.toBeNull();
    expect(button("Share")).toBeDefined();
    expect(button("Flag")).toBeDefined();
    expect(button("Edit")).toBeDefined();
    expect(button("Delete")).toBeDefined();
    // Series, in part order, from Dexie
    expect(text()).toContain("Series (2 parts)");
  });

  it("edits through the form and hands back cleared fields as undefined", async () => {
    const onEdit = vi.fn();
    render({ onEdit });
    await flush();

    act(() => button("Edit")!.click());
    const inputs = host.querySelectorAll("input");
    expect((inputs[0] as HTMLInputElement).value).toBe("Phoenix Lights");
    expect((inputs[1] as HTMLInputElement).value).toBe("Ed Dames");

    act(() => button("Save")!.click());
    expect(onEdit).toHaveBeenCalledWith(1, expect.objectContaining({
      title: "Phoenix Lights",
      guestName: "Ed Dames",
      showType: "coast",
      topic: undefined,
    }));
    // Back to view mode.
    expect(button("Save")).toBeUndefined();
    expect(button("Edit")).toBeDefined();
  });

  it("omits admin actions the page did not pass", async () => {
    render();
    await flush();
    expect(button("Edit")).toBeUndefined();
    expect(button("Delete")).toBeUndefined();
  });
});
