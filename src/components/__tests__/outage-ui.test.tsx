import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";
import { archiveDownFixture, archiveUpFixture, resetOutage } from "@/test-support/outage";

/**
 * Outage mode as a listener sees it, in the two fixture states: the banner,
 * the row marks and dimming, the "Playable now" filter, and the dialog.
 *
 * `fetch` throws if anything calls it. Every one of these surfaces reads the
 * outage store and IndexedDB; none of them may wait on the network to show
 * what it shows — the dialog least of all.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let library: Episode[] = [];
vi.mock("@/db", () => ({
  db: { episodes: { toArray: () => Promise.resolve(library) } },
  getPreference: () => new Promise(() => {}),
  setPreference: async () => {},
}));
// The real hook needs a Dexie database to observe; this runs the querier the
// same way on every dependency change, which is all these surfaces need.
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: <T,>(fn: () => Promise<T>, deps: unknown[]) => {
    const [v, setV] = useState<T | undefined>(undefined);
    useEffect(() => {
      let live = true;
      void fn().then((r) => live && setV(r));
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return v;
  },
}));

const { OfflineIndicator, OUTAGE_BANNER_TEXT } = await import("@/components/OfflineIndicator");
const { EpisodeCard } = await import("@/components/library/EpisodeCard");
const { OutageDialog } = await import("@/components/player/OutageDialog");
const { PlayableNowBar } = await import("@/components/library/LibraryFilterBars");
const { useLibraryFilters } = await import("@/hooks/library/useLibraryFilters");
const { useOutageStore } = await import("@/stores/outage-store");

const COLL = "ultimate-ultimate-art-bell-collection";
function ep(title: string, over: Partial<Episode> = {}): Episode {
  const fileName = `${over.airDate ?? "1997-03-13"} - ${title}.mp3`;
  return {
    id: title.length,
    fileHash: `archive:${COLL}:${fileName}`,
    fileName,
    title,
    airDate: "1997-03-13",
    sourceUrl: `https://archive.org/download/${COLL}/${fileName}`,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

const PINNED = ep("Phoenix Lights");
const UNPINNED = ep("Hale-Bopp Companion", { guestName: "Courtney Brown", aiCategory: "Space", airDate: "1996-11-14" });
const LOCAL = { ...ep("Tape from the attic"), fileHash: "md5:0123456789abcdef" } as Episode;

let container: HTMLDivElement;
let root: Root;
function render(node: React.ReactNode) {
  act(() => root.render(node));
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  resetOutage();
  library = [];
  vi.stubGlobal("fetch", () => {
    throw new Error("outage mode must not wait on the network");
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const card = (e: Episode) =>
  createElement(EpisodeCard, { key: e.fileHash, episode: e, onClick: () => {} });
const row = (e: Episode) => container.querySelector(`[aria-label^="${e.title}"]`) as HTMLElement;

describe("up (archiveUpFixture)", () => {
  it("no banner, no marks, no dimming — even with a manifest in hand", () => {
    archiveUpFixture([PINNED.fileHash]);
    render(createElement("div", null, createElement(OfflineIndicator), card(PINNED), card(UNPINNED)));
    expect(container.textContent).not.toContain(OUTAGE_BANNER_TEXT);
    expect(container.querySelector("[data-availability-mark]")).toBeNull();
    expect(row(PINNED).dataset.availability).toBe("normal");
    expect(row(UNPINNED).dataset.availability).toBe("normal");
    expect(row(UNPINNED).className).not.toContain("grayscale");
  });
});

describe("down (archiveDownFixture)", () => {
  it("the banner says what is happening, in those words", () => {
    archiveDownFixture([PINNED.fileHash]);
    render(createElement(OfflineIndicator));
    expect(container.querySelector("[data-testid=outage-banner]")?.textContent).toContain(
      "archive.org is down. Playing from the High Desert mirror.",
    );
  });

  it("pinned rows carry MIRROR; unpinned rows dim; a local file is untouched", () => {
    archiveDownFixture([PINNED.fileHash]);
    render(createElement("div", null, card(PINNED), card(UNPINNED), card(LOCAL)));

    expect(row(PINNED).dataset.availability).toBe("mirror");
    expect(row(PINNED).querySelector("[data-availability-mark]")?.textContent).toBe("MIRROR");
    expect(row(PINNED).getAttribute("aria-label")).toContain("plays from the mirror");

    expect(row(UNPINNED).dataset.availability).toBe("unavailable");
    expect(row(UNPINNED).className).toContain("grayscale");
    expect(row(UNPINNED).querySelector("[data-availability-mark]")).toBeNull();
    expect(row(UNPINNED).getAttribute("aria-label")).toContain("unavailable until archive.org returns");

    expect(row(LOCAL).dataset.availability).toBe("normal");
  });

  it("banner and dimming clear on their own when archive.org returns", () => {
    archiveDownFixture([PINNED.fileHash]);
    render(createElement("div", null, createElement(OfflineIndicator), card(UNPINNED)));
    expect(container.textContent).toContain(OUTAGE_BANNER_TEXT);
    expect(row(UNPINNED).dataset.availability).toBe("unavailable");

    act(() => useOutageStore.getState().setArchiveUp(true));
    expect(container.textContent).not.toContain(OUTAGE_BANNER_TEXT);
    expect(row(UNPINNED).dataset.availability).toBe("normal");
    expect(row(UNPINNED).className).not.toContain("grayscale");
  });

  it("the dialog is on screen the moment a start is refused, then offers three shows that play", async () => {
    const sameGuest = ep("Remote Viewing Hale-Bopp", { guestName: "Courtney Brown", airDate: "1997-01-15" });
    const sameCategory = ep("Mars Anomalies", { aiCategory: "Space", airDate: "1998-06-01" });
    const sameYear = ep("Ghost Hour", { airDate: "1996-10-31" });
    const unrelatedPinned = ep("Area 51 Caller", { airDate: "2003-02-02" });
    const sameGuestButNotPinned = ep("Courtney Brown Returns", { guestName: "Courtney Brown", airDate: "1996-11-15" });
    library = [UNPINNED, sameGuest, sameCategory, sameYear, unrelatedPinned, sameGuestButNotPinned];
    archiveDownFixture([sameGuest.fileHash, sameCategory.fileHash, sameYear.fileHash, unrelatedPinned.fileHash]);

    render(createElement(OutageDialog));
    expect(container.querySelector("[data-testid=outage-dialog]")).toBeNull();

    act(() => useOutageStore.getState().showUnavailable(UNPINNED));
    // Synchronously: no await between the refusal and the dialog.
    const dialog = document.querySelector("[data-testid=outage-dialog]");
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Hale-Bopp Companion");

    await flush();
    const offered = [...document.querySelectorAll("[data-suggestion]")].map((b) => [
      b.getAttribute("data-suggestion"),
      b.querySelector("span")?.textContent,
    ]);
    expect(offered).toEqual([
      ["guest", "Remote Viewing Hale-Bopp"],
      ["category", "Mars Anomalies"],
      ["year", "Ghost Hour"],
    ]);
  });
});

describe("the Playable now filter", () => {
  function Harness() {
    const filters = useLibraryFilters();
    return createElement("div", { "data-set": filters.playableSet ? [...filters.playableSet].join("|") : "" },
      createElement(PlayableNowBar, { filters }));
  }
  const toggle = () => container.querySelector("[data-testid=playable-now]") as HTMLButtonElement | null;
  const filteringOn = () => (container.firstChild as HTMLElement).dataset.set;

  it("is absent while archive.org is up", () => {
    archiveUpFixture([PINNED.fileHash]);
    render(createElement(Harness));
    expect(toggle()).toBeNull();
    expect(filteringOn()).toBe("");
  });

  it("turns on by default when the outage starts, can be turned off, and goes away when it ends", () => {
    archiveUpFixture([PINNED.fileHash]);
    render(createElement(Harness));

    act(() => archiveDownFixture([PINNED.fileHash]));
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    expect(filteringOn()).toBe(PINNED.fileHash);

    act(() => toggle()!.click());
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
    expect(filteringOn()).toBe("");

    act(() => useOutageStore.getState().setArchiveUp(true));
    expect(toggle()).toBeNull();
    expect(filteringOn()).toBe("");
  });
});
