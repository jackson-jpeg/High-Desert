import { describe, it, expect } from "vitest";
import { catalog, withEpisodeInfo } from "../catalog";
import COMMUNITY_KEYS from "@/data/community-keys.json";

/**
 * The export exists so sang3r.com can show what people are listening to. That
 * only works if an episode id coming back out of Postgres can be turned into a
 * title — and the id in Postgres is whatever the allowlist let through.
 *
 * So the two sets have to agree. If the catalog loader ever keys episodes
 * differently from the allowlist generator, nothing throws: the dashboard just
 * quietly starts listing raw community keys, which is the failure mode this
 * guards against.
 */

describe("stats catalog", () => {
  it("resolves every allowlisted episode id to a title", async () => {
    const map = await catalog();
    const keys = COMMUNITY_KEYS as string[];

    expect(map.size).toBeGreaterThan(0);

    const unresolved = keys.filter((k) => !map.has(k));
    expect(
      unresolved.slice(0, 5),
      `${unresolved.length} of ${keys.length} allowlisted ids have no catalog entry`,
    ).toEqual([]);
  });

  it("gives every entry a non-empty title", async () => {
    const map = await catalog();
    const untitled = [...map.entries()].filter(([, v]) => !v.title?.trim());
    expect(untitled.slice(0, 5)).toEqual([]);
  });

  it("keeps unknown ids instead of dropping them", async () => {
    const rows = [{ episodeId: "not-a-real-episode", plays: 3 }];
    const [enriched] = await withEpisodeInfo(rows);

    // Dropping the row would make the listed plays disagree with the totals in
    // the summary, which is worse than a row with no title.
    expect(enriched.episodeId).toBe("not-a-real-episode");
    expect(enriched.plays).toBe(3);
    expect(enriched.title).toBeNull();
    expect(enriched.airDate).toBeNull();
  });

  it("attaches catalog fields to a known id", async () => {
    const known = (COMMUNITY_KEYS as string[])[0];
    const [enriched] = await withEpisodeInfo([{ episodeId: known }]);

    expect(enriched.title).toBeTruthy();
    expect(typeof enriched.title).toBe("string");
  });
});
