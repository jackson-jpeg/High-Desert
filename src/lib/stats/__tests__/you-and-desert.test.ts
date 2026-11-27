import { describe, it, expect } from "vitest";
import type { Episode, HistoryEntry } from "@/db/schema";
import { communityKey } from "@/lib/utils/community-key";
import { youAndTheDesert } from "../you-and-desert";

/** "You and the desert" (UI plan push 6, batch 4): real listens, real plays. */

const ep = (id: number, guestName: string | undefined, archive = true) =>
  ({
    id,
    title: `Show ${id}`,
    fileName: `show-${id}.mp3`,
    fileHash: archive ? `archive:c:show-${id}.mp3` : `local:${id}`,
    archiveIdentifier: archive ? "c" : undefined,
    guestName,
  }) as unknown as Episode;

const EPISODES = [ep(1, "Bob Lazar"), ep(2, "Bob Lazar"), ep(3, "Mel Waters"), ep(4, "Richard Hoagland"), ep(5, "Mel Waters", false)];
const h = (episodeId: number, duration: number): HistoryEntry => ({ episodeId, timestamp: 1, duration });
const community = new Map(
  [
    [EPISODES[2], 40],
    [EPISODES[3], 25],
    [EPISODES[0], 30],
    [EPISODES[1], 30],
  ].map(([e, plays]) => [communityKey(e as Episode)!, { plays: plays as number, avg: 0, count: 0 }]),
);

describe("youAndTheDesert", () => {
  it("counts catalog shows heard for a minute or more, out of the catalog shows", () => {
    const d = youAndTheDesert(EPISODES, [h(1, 600), h(1, 900), h(3, 30), h(5, 9_000)], community);
    expect(d.catalog).toBe(4);
    expect(d.heard).toBe(1);
  });

  it("your top guest is by time heard, summed over their shows; the station's by plays", () => {
    const d = youAndTheDesert(EPISODES, [h(1, 600), h(2, 600), h(3, 1_000), h(4, 100)], community);
    expect(d.yourGuest).toEqual({ name: "Bob Lazar", seconds: 1_200 });
    // 30 + 30 across two shows beats Mel Waters's one show at 40.
    expect(d.stationGuest).toEqual({ name: "Bob Lazar", plays: 60 });
  });

  it("nothing heard and nothing played: no guests, nothing invented", () => {
    const d = youAndTheDesert(EPISODES, [h(1, 10)], new Map());
    expect(d).toMatchObject({ heard: 0, yourGuest: null, stationGuest: null });
  });
});
