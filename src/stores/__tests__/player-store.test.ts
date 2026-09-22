import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Episode } from "@/db/schema";
import { usePlayerStore } from "../player-store";

/**
 * The queue arithmetic in usePlayerStore (HD-015 item 3).
 *
 * CLAUDE.md said all nine stores were tested; this one was not, and it is the
 * one whose bookkeeping a listener feels. `queueIndex` is the only record of
 * which row is playing, so a move or removal that forgets to shift it leaves
 * the highlight on the wrong show, and Next then skips or repeats one.
 *
 * The move and removal tests are exhaustive over a five-item queue rather
 * than a few hand-picked cases: every current position, every source, every
 * destination. The property checked is the one that matters — the episode
 * that was current is still the one `queueIndex` points at — plus the exact
 * resulting order, so an index that is "right" over a scrambled queue does
 * not pass either.
 */

const s = () => usePlayerStore.getState();

function ep(id: number): Episode {
  return { id, title: `Show ${id}`, fileName: `show-${id}.mp3` } as Episode;
}

const ids = () => s().queue.map((e) => e.id);
const current = () => s().queue[s().queueIndex]?.id;

function reset(queue: Episode[] = [], queueIndex = -1) {
  usePlayerStore.setState({
    queue,
    queueIndex,
    shuffle: false,
    repeat: "off",
    currentEpisode: null,
    objectUrl: null,
  });
}

beforeEach(() => reset());
afterEach(() => vi.restoreAllMocks());

const FIVE = () => [1, 2, 3, 4, 5].map(ep);

describe("moveInQueue", () => {
  it("keeps queueIndex on the same episode for every move in a five-item queue", () => {
    let checked = 0;
    for (let cur = 0; cur < 5; cur++) {
      for (let from = 0; from < 5; from++) {
        for (let to = 0; to < 5; to++) {
          reset(FIVE(), cur);
          const playing = current();
          const expected = [1, 2, 3, 4, 5];
          const [moved] = expected.splice(from, 1);
          expected.splice(to, 0, moved);

          s().moveInQueue(from, to);

          const where = `cur=${cur} from=${from} to=${to}`;
          expect(ids(), where).toEqual(expected);
          expect(current(), where).toBe(playing);
          checked++;
        }
      }
    }
    expect(checked).toBe(125);
  });

  // The two boundary cases an off-by-one lands on, spelled out so a failure
  // names them rather than only a loop coordinate.
  it("moving a row from above the current one down onto its slot shifts the index up", () => {
    reset(FIVE(), 2); // playing 3
    s().moveInQueue(0, 2); // 1 lands where 3 was
    expect(ids()).toEqual([2, 3, 1, 4, 5]);
    expect(s().queueIndex).toBe(1);
    expect(current()).toBe(3);
  });

  it("moving a row from below the current one up onto its slot shifts the index down", () => {
    reset(FIVE(), 2); // playing 3
    s().moveInQueue(4, 2); // 5 lands where 3 was
    expect(ids()).toEqual([1, 2, 5, 3, 4]);
    expect(s().queueIndex).toBe(3);
    expect(current()).toBe(3);
  });

  it("moving the current row takes the index with it", () => {
    reset(FIVE(), 1);
    s().moveInQueue(1, 4);
    expect(ids()).toEqual([1, 3, 4, 5, 2]);
    expect(s().queueIndex).toBe(4);
  });

  it("ignores out-of-range indices and leaves the queue untouched", () => {
    reset(FIVE(), 2);
    for (const [from, to] of [[-1, 2], [2, -1], [5, 0], [0, 5]]) {
      s().moveInQueue(from, to);
      expect(ids()).toEqual([1, 2, 3, 4, 5]);
      expect(s().queueIndex).toBe(2);
    }
  });
});

describe("removeFromQueue", () => {
  it("keeps queueIndex on the same episode when a different row is removed", () => {
    for (let cur = 0; cur < 5; cur++) {
      for (let at = 0; at < 5; at++) {
        if (at === cur) continue;
        reset(FIVE(), cur);
        const playing = current();
        s().removeFromQueue(at);
        const where = `cur=${cur} at=${at}`;
        expect(ids(), where).toEqual([1, 2, 3, 4, 5].filter((_, i) => i !== at));
        expect(current(), where).toBe(playing);
      }
    }
  });

  it("removing the current row points the index at the one that followed it", () => {
    reset(FIVE(), 1); // playing 2
    s().removeFromQueue(1);
    expect(ids()).toEqual([1, 3, 4, 5]);
    expect(current()).toBe(3);
  });

  it("removing the current row when it is last points at the new last row", () => {
    reset(FIVE(), 4);
    s().removeFromQueue(4);
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(s().queueIndex).toBe(3);
  });

  it("removing the only row leaves an empty queue with nothing current", () => {
    reset([ep(1)], 0);
    s().removeFromQueue(0);
    expect(ids()).toEqual([]);
    expect(s().queueIndex).toBe(-1);
  });

  it("ignores an out-of-range index", () => {
    reset(FIVE(), 2);
    s().removeFromQueue(5);
    s().removeFromQueue(-1);
    expect(ids()).toEqual([1, 2, 3, 4, 5]);
    expect(s().queueIndex).toBe(2);
  });
});

describe("inserting", () => {
  it("loadEpisode puts a new show right after the current one and makes it current", () => {
    reset(FIVE(), 1);
    s().loadEpisode(ep(9), "");
    expect(ids()).toEqual([1, 2, 9, 3, 4, 5]);
    expect(s().queueIndex).toBe(2);
    expect(s().currentEpisode?.id).toBe(9);
  });

  it("loadEpisode of a show already queued jumps to it without duplicating it", () => {
    reset(FIVE(), 0);
    s().loadEpisode(ep(4), "");
    expect(ids()).toEqual([1, 2, 3, 4, 5]);
    expect(current()).toBe(4);
  });

  it("loadEpisode into an empty queue starts it at 0", () => {
    s().loadEpisode(ep(7), "");
    expect(ids()).toEqual([7]);
    expect(s().queueIndex).toBe(0);
  });

  it("enqueueNext inserts after the current show and does not move the index", () => {
    reset(FIVE(), 2);
    s().enqueueNext(ep(9));
    expect(ids()).toEqual([1, 2, 3, 9, 4, 5]);
    expect(current()).toBe(3);
    // Next then plays it.
    expect(s().next()?.id).toBe(9);
  });

  it("enqueue, enqueueNext and enqueueMany never duplicate a queued show", () => {
    reset(FIVE(), 0);
    s().enqueue(ep(3));
    s().enqueueNext(ep(5));
    s().enqueueMany([ep(2), ep(8)]);
    expect(ids()).toEqual([1, 2, 3, 4, 5, 8]);
    expect(current()).toBe(1);
  });
});

describe("next / previous", () => {
  it("walks forward and back, and stops at both ends when repeat is off", () => {
    reset(FIVE(), 0);
    expect(s().previous()).toBeNull();
    expect(s().queueIndex).toBe(0);
    for (const id of [2, 3, 4, 5]) expect(s().next()?.id).toBe(id);
    expect(s().next()).toBeNull();
    expect(s().queueIndex).toBe(4);
    expect(s().hasNext()).toBe(false);
    expect(s().previous()?.id).toBe(4);
    expect(s().hasPrevious()).toBe(true);
  });

  it("repeat-all wraps from the last show to the first", () => {
    reset(FIVE(), 4);
    usePlayerStore.setState({ repeat: "all" });
    expect(s().hasNext()).toBe(true);
    expect(s().next()?.id).toBe(1);
    expect(s().queueIndex).toBe(0);
  });

  it("repeat-one hands back the same show at the end of a track, but a pressed Next moves on", () => {
    reset(FIVE(), 2);
    usePlayerStore.setState({ repeat: "one" });
    expect(s().next()?.id).toBe(3);
    expect(s().queueIndex).toBe(2);
    expect(s().next({ manual: true })?.id).toBe(4);
    expect(s().queueIndex).toBe(3);
  });

  it("shuffle never picks the show that is already playing", () => {
    reset(FIVE(), 2);
    usePlayerStore.setState({ shuffle: true });
    // First draw lands on the current row (index 2); the store must draw again.
    const draws = [0.5, 0.5, 0.9];
    vi.spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0);
    expect(s().next()?.id).toBe(5);
    expect(s().queueIndex).toBe(4);
  });

  it("repeat-one outranks shuffle at the end of a track; a pressed Next shuffles", () => {
    reset(FIVE(), 1);
    usePlayerStore.setState({ shuffle: true, repeat: "one" });
    vi.spyOn(Math, "random").mockReturnValue(0.0);
    expect(s().next()?.id).toBe(2);
    expect(s().next({ manual: true })?.id).toBe(1);
  });

  it("shuffle over a single show falls through to the linear rules", () => {
    reset([ep(1)], 0);
    usePlayerStore.setState({ shuffle: true });
    expect(s().next()).toBeNull();
    usePlayerStore.setState({ repeat: "all" });
    expect(s().next()?.id).toBe(1);
  });

  it("cycleRepeat goes off → all → one → off", () => {
    const seen = [s().repeat];
    for (let i = 0; i < 3; i++) {
      s().cycleRepeat();
      seen.push(s().repeat);
    }
    expect(seen).toEqual(["off", "all", "one", "off"]);
  });
});
