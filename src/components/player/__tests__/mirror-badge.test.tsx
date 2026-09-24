import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Episode } from "@/db/schema";

/** VIA MIRROR shows exactly while the element plays from the mirror; Magnet asks the gateway. */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { usePlayerStore } = await import("@/stores/player-store");
const { MirrorBadge } = await import("../MirrorBadge");
const { MagnetLink } = await import("@/components/library/EpisodeActions");

const ep = { id: 1, fileHash: "archive:coll:a b.mp3", fileName: "a b.mp3", createdAt: 0, updatedAt: 0 } as Episode;

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

afterEach(() => {
  usePlayerStore.setState({ currentEpisode: null, source: null });
  vi.unstubAllGlobals();
});

describe("VIA MIRROR", () => {
  it("shows while playing from the mirror, and not from anywhere else", () => {
    const { host, done } = render(<MirrorBadge />);
    for (const source of ["archive", "cache", "local", null] as const) {
      act(() => usePlayerStore.setState({ currentEpisode: ep, source }));
      expect(host.querySelector('[data-testid="via-mirror"]'), String(source)).toBeNull();
    }
    act(() => usePlayerStore.setState({ currentEpisode: ep, source: "mirror" }));
    expect(host.querySelector('[data-testid="via-mirror"]')?.textContent).toBe("VIA MIRROR");
    act(() => usePlayerStore.getState().stop());
    expect(host.querySelector('[data-testid="via-mirror"]')).toBeNull();
    done();
  });
});

describe("Magnet", () => {
  it("asks the gateway for this episode's magnet", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ magnet: "magnet:?xt=urn:btih:abc" })));
    vi.stubGlobal("fetch", fetchMock);
    const { host, done } = render(<MagnetLink episode={ep} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="magnet-link"]')!.click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(`/mirror/magnet/${encodeURIComponent(ep.fileHash)}`);
    done();
  });
});
