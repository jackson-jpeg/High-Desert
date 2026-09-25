import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";
import { REMOVED_FROM_CATALOG } from "@/lib/library/removed-episodes";

/**
 * A returning visitor's copy of an episode pulled from the catalog
 * (docs/broken-episodes.md). reconcileLibrary never deletes, so it is still in
 * their IndexedDB; it must say it is unavailable, and removing it must be the
 * listener's decision — through the library's confirmation and deleteEpisode(),
 * never automatically.
 *
 * Real EpisodeCard, EpisodeDetail and useLibraryActions; `deleteEpisode` is a
 * spy so the test can see exactly when (and whether) it is called — its own
 * behaviour is delete-episode.test.ts's subject.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const deleteEpisode = vi.fn<(id: number) => Promise<void>>(() => Promise.resolve());
vi.mock("@/services/episodes/management", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/episodes/management")>();
  return { ...real, deleteEpisode: (id: number) => deleteEpisode(id) };
});
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));
vi.mock("@/components/player/BookmarkMarkers", () => ({ BookmarkList: () => null }));
vi.mock("@/components/library/MoreLikeThis", () => ({ MoreLikeThis: () => null }));
vi.mock("@/components/library/EpisodeRating", () => ({
  EpisodeRating: () => null,
  useCommunityRating: () => null,
}));

const { EpisodeCard } = await import("@/components/library/EpisodeCard");
const { EpisodeDetail } = await import("@/components/library/EpisodeDetail");
const { useLibraryActions } = await import("@/hooks/library/useLibraryActions");
const { useContextMenuStore } = await import("@/stores/context-menu-store");
const { useAdminStore } = await import("@/stores/admin-store");
const { mountHook } = await import("@/hooks/__tests__/support/mount-player");
const { UnavailableEpisodeDialog } = await import("@/components/player/UnavailableEpisodeDialog");
const { emit } = await import("@/lib/events");
const { UNAVAILABLE_TITLE } = await import("@/lib/library/removed-episodes");

const [PULLED_HASH] = REMOVED_FROM_CATALOG.keys();
const PULLED: Episode = {
  id: 1313,
  fileHash: PULLED_HASH,
  fileName: PULLED_HASH.split(":").slice(2).join(":"),
  archiveIdentifier: "ultimate-ultimate-art-bell-collection",
  source: "archive",
  sourceUrl: "https://archive.org/download/x/y.mp3",
  title: "Coast to Coast AM - Climate Change",
  airDate: "2002-03-19",
  showType: "coast",
  createdAt: 0,
  updatedAt: 0,
} as Episode;
/** The same broadcast as a scanned local file: never marked. */
const LOCAL: Episode = {
  ...PULLED,
  id: 7,
  fileHash: "5d41402abc4b2a76b9719d911017c592",
  source: "local",
  sourceUrl: undefined,
  archiveIdentifier: undefined,
} as Episode;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  deleteEpisode.mockClear();
  useAdminStore.setState({ isAdmin: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the list row", () => {
  it("marks the pulled episode Unavailable, in both layouts and the accessible name", () => {
    act(() => root.render(createElement(EpisodeCard, { episode: PULLED, onClick: () => {} })));
    expect(host.querySelectorAll("[data-unavailable]").length).toBe(2);
    expect(host.querySelector("[role=option]")!.getAttribute("aria-label")).toContain("(unavailable)");
  });

  it("does not mark a local file of the same show", () => {
    act(() => root.render(createElement(EpisodeCard, { episode: LOCAL, onClick: () => {} })));
    expect(host.querySelector("[data-unavailable]")).toBeNull();
  });
});

describe("the detail panel", () => {
  it("says Unavailable and offers removal, which only requests it", () => {
    const onRemove = vi.fn();
    act(() =>
      root.render(
        createElement(EpisodeDetail, {
          episode: PULLED,
          isPlaying: false,
          onPlay: () => {},
          onClose: () => {},
          onRemoveUnavailable: onRemove,
        }),
      ),
    );
    const notice = host.querySelector("[data-unavailable]");
    expect(notice?.textContent).toContain("Unavailable");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Remove from my library");
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(onRemove).toHaveBeenCalledWith(PULLED);
    expect(deleteEpisode).not.toHaveBeenCalled();
  });

  it("offers nothing of the kind for a local file", () => {
    act(() =>
      root.render(
        createElement(EpisodeDetail, {
          episode: LOCAL,
          isPlaying: false,
          onPlay: () => {},
          onClose: () => {},
          onRemoveUnavailable: vi.fn(),
        }),
      ),
    );
    expect(host.querySelector("[data-unavailable]")).toBeNull();
    expect(host.textContent).not.toContain("Remove from my library");
  });
});

describe("removal goes through the confirmation and deleteEpisode()", () => {
  function mountActions() {
    return mountHook(() =>
      useLibraryActions({
        allEpisodes: [PULLED, LOCAL],
        allPlaylists: [],
        currentEpisodeId: undefined,
        selectedEpisode: PULLED,
        setSelectedEpisode: () => {},
        selectedIds: new Set(),
        setSelectedIds: () => {},
      }),
    );
  }
  const menuItem = (label: string) => useContextMenuStore.getState().items.find((i) => i.label === label);

  it("the row menu offers it to a non-admin; choosing it opens the confirmation and deletes nothing", async () => {
    const actions = mountActions();
    act(() => actions.api.handleContextMenu(PULLED, 0, 0));
    const item = menuItem("Remove from my library");
    expect(item).toBeDefined();

    act(() => item!.onClick());
    expect(deleteEpisode).not.toHaveBeenCalled();
    expect(actions.api.deleteOpen).toBe(true);
    expect(actions.api.pendingDeleteCount).toBe(1);

    // Cancel: still nothing deleted.
    act(() => actions.api.setDeleteOpen(false));
    expect(deleteEpisode).not.toHaveBeenCalled();

    // Confirm: deleteEpisode, for exactly this row.
    act(() => menuItem("Remove from my library")!.onClick());
    await act(async () => actions.api.handleConfirmDelete());
    expect(deleteEpisode).toHaveBeenCalledTimes(1);
    expect(deleteEpisode).toHaveBeenCalledWith(1313);
    actions.unmount();
  });

  it("is not offered for a local file", () => {
    const actions = mountActions();
    act(() => actions.api.handleContextMenu(LOCAL, 0, 0));
    expect(menuItem("Remove from my library")).toBeUndefined();
    actions.unmount();
  });
});

describe("the play-time explanation", () => {
  it("opens on episode-unavailable, names the show and why, and closes", () => {
    act(() => root.render(createElement(UnavailableEpisodeDialog)));
    expect(document.body.textContent).not.toContain(UNAVAILABLE_TITLE);
    act(() => emit("episode-unavailable", PULLED));
    const dialog = document.querySelector("[data-unavailable-dialog]");
    expect(dialog).not.toBeNull();
    expect(document.body.textContent).toContain(UNAVAILABLE_TITLE);
    expect(dialog!.textContent).toContain(PULLED.title);
    expect(dialog!.textContent).toContain(REMOVED_FROM_CATALOG.get(PULLED_HASH)!.reason);
    const ok = [...document.querySelectorAll("button")].find((b) => b.textContent === "OK");
    act(() => ok!.click());
    expect(document.querySelector("[data-unavailable-dialog]")).toBeNull();
  });
});
