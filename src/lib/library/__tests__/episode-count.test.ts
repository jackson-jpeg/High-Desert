import { describe, it, expect } from "vitest";
import { knownEpisodeCount, episodeCountLabel } from "@/lib/library/episode-count";

/**
 * The status bar's episode count (2026-10-13). A first visit read "0 episodes"
 * for several seconds on production, in both looks, while the library was
 * being seeded: the live count answers 0 before the seed's first write, and
 * the layout passed `count ?? 0`. An empty table means nothing until the seed
 * has settled.
 */
describe("knownEpisodeCount", () => {
  it("is unknown before the live query answers", () => {
    expect(knownEpisodeCount(undefined, false)).toBeNull();
    expect(knownEpisodeCount(undefined, true)).toBeNull();
  });

  it("is unknown for an empty table while the seed has not settled", () => {
    expect(knownEpisodeCount(0, false)).toBeNull();
  });

  it("is 0 for an empty table once the seed has settled (a cleared library)", () => {
    expect(knownEpisodeCount(0, true)).toBe(0);
  });

  it("is the count as soon as there are rows, settled or not", () => {
    expect(knownEpisodeCount(1413, false)).toBe(1413);
    expect(knownEpisodeCount(1413, true)).toBe(1413);
  });
});

describe("episodeCountLabel", () => {
  it("says the library is loading, never 0, while the count is unknown", () => {
    expect(episodeCountLabel(null)).toBe("Loading library");
  });

  it("counts episodes, singular and plural", () => {
    expect(episodeCountLabel(1413)).toBe(`${(1413).toLocaleString()} episodes`);
    expect(episodeCountLabel(1)).toBe("1 episode");
    expect(episodeCountLabel(0)).toBe("0 episodes");
  });
});
