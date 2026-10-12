import { describe, it, expect } from "vitest";
import type { Episode, Progress } from "@/db/schema";
import { CONTINUE_MIN_SECONDS, continueItems, remainingLabel } from "@/lib/library/continue-listening";
import { REMOVED_FROM_CATALOG } from "@/lib/library/removed-episodes";

/**
 * What Continue listening offers: the play path's own idea of "part way"
 * (startPositionFor), newest first (src/lib/library/continue-listening.ts).
 */

const ep = (n: number, duration: number | undefined = 3 * 3600, over: Partial<Episode> = {}) =>
  ({ id: n, fileHash: `archive:c:${n}.mp3`, fileName: `${n}.mp3`, title: `Show ${n}`, duration, ...over }) as Episode;
const at = (e: Episode, playbackPosition: number | undefined, lastPlayedAt = 1): { episode: Episode; progress: Progress } => ({
  episode: e,
  progress: { fileHash: e.fileHash, playbackPosition, lastPlayedAt },
});

describe("continueItems", () => {
  it("offers a show stopped part way, at the second it will resume from, with what is left", () => {
    const [item] = continueItems([at(ep(1), 3600)]);
    expect(item.position).toBe(3600);
    expect(item.remaining).toBe(2 * 3600);
    expect(item.percent).toBe(33);
  });

  it("keeps the order it is given (newest first) and stops at the limit", () => {
    const items = continueItems([at(ep(1), 600), at(ep(2), 600), at(ep(3), 600), at(ep(4), 600)]);
    expect(items.map((i) => i.episode.id)).toEqual([1, 2, 3]);
  });

  it("leaves out a sample, a finished show and one never started", () => {
    expect(continueItems([at(ep(1), CONTINUE_MIN_SECONDS - 1)])).toEqual([]);
    expect(continueItems([at(ep(2), 3 * 3600 - 10)])).toEqual([]); // within 30 s of the end
    expect(continueItems([at(ep(3), 3 * 3600 * 0.96)])).toEqual([]); // past 95%
    expect(continueItems([at(ep(4), undefined)])).toEqual([]);
    expect(continueItems([at(ep(5), CONTINUE_MIN_SECONDS)])).toHaveLength(1);
  });

  it("leaves out the show already in the player, and a pulled show", () => {
    const pulled = [...REMOVED_FROM_CATALOG.keys()][0];
    const items = continueItems([at(ep(1), 600), at(ep(2, undefined, { fileHash: pulled }), 600), at(ep(3), 600)], {
      exclude: "archive:c:1.mp3",
    });
    expect(items.map((i) => i.episode.id)).toEqual([3]);
  });

  it("a show with no known length still resumes, without a bar", () => {
    const [item] = continueItems([at(ep(1, 0), 900)]);
    expect(item).toMatchObject({ position: 900, remaining: null, percent: null });
  });
});

describe("remainingLabel", () => {
  it("says hours and minutes, plainly", () => {
    expect(remainingLabel(2 * 3600 + 12 * 60)).toBe("2 h 12 min left");
    expect(remainingLabel(38 * 60)).toBe("38 min left");
    expect(remainingLabel(20)).toBe("under a minute left");
    expect(remainingLabel(null)).toBeNull();
  });
});
