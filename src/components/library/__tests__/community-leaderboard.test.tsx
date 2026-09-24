import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * Community Top 20 (Part 1D): each row's number is the server's play count for
 * that episode, in the server's order, and the drill-down opens the library on
 * "Most played" — the sort that orders by those same community plays.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/stats",
}));

const { db } = await import("@/db");
const { communityKey } = await import("@/lib/utils/community-key");
const { CommunityLeaderboard } = await import("../CommunityLeaderboard");

const eps = [1, 2, 3].map(
  (i) =>
    ({
      fileName: `${i}.mp3`,
      fileHash: `archive:coll:${i}.mp3`,
      archiveIdentifier: "coll",
      title: `Show ${i}`,
      createdAt: 0,
      updatedAt: 0,
    }) as Episode,
);
const ENTRIES = [
  { episodeId: communityKey(eps[2])!, plays: 132 },
  { episodeId: communityKey(eps[0])!, plays: 41 },
  { episodeId: communityKey(eps[1])!, plays: 6 },
];

describe("Community Top 20", () => {
  it("shows the server's counts in its order, and drills into Most played", async () => {
    await db.episodes.bulkAdd(eps);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ entries: ENTRIES }), { headers: { "content-type": "application/json" } })),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CommunityLeaderboard />));
    await expect.poll(() => host.textContent, { timeout: 10_000 }).toContain("Show 3");

    const rows = [...host.querySelectorAll("button")].filter((b) => b.textContent?.includes("Show"));
    expect(rows.map((r) => r.textContent?.match(/Show \d/)?.[0])).toEqual(["Show 3", "Show 1", "Show 2"]);
    expect(rows.map((r) => Number(r.lastElementChild?.textContent))).toEqual([132, 41, 6]);

    const more = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("sorted by Most played"))!;
    act(() => more.click());
    expect(push).toHaveBeenCalledWith("/library?sort=played");
    act(() => root.unmount());
  });
});
