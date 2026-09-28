import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Episode } from "@/db/schema";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";

/**
 * A first-time listener tunes in before the library has seeded, so the show
 * plays from a row made from its slot — no id, so never saved as the episode
 * a reload restores. Once the library holds the row, the player must be handed
 * it. The database is the only thing replaced; the stores are real.
 */

const held = vi.hoisted(() => ({ rows: [] as Episode[], deps: null as null | { leavePlayer?: () => void } }));
const prefs = vi.hoisted(() => ({ deleted: [] as string[] }));
const stopped = vi.hoisted(() => ({ n: 0 }));

vi.mock("@/db", () => ({
  db: {
    episodes: {
      where: () => ({
        anyOf: (hashes: string[]) => ({
          toArray: async () => held.rows.filter((r) => hashes.includes(r.fileHash)),
        }),
      }),
    },
  },
  deletePreference: (key: string) => {
    prefs.deleted.push(key);
    return Promise.resolve();
  },
}));
vi.mock("@/audio/live-controller", () => ({
  installLiveStation: (deps: { leavePlayer?: () => void }) => {
    held.deps = deps;
    return () => {};
  },
}));
vi.mock("@/audio/live-session", () => ({ stopPlayerForLive: () => void (stopped.n += 1) }));

const { installBrowserLiveStation, episodeFromSlot, prefetchSlotStart, PREFETCH_BYTES } = await import(
  "../browser-station"
);
const { archiveDownFixture, archiveUpFixture, resetOutage } = await import("@/test-support/outage");
const { usePlayerStore } = await import("@/stores/player-store");
const { useLiveStore } = await import("@/stores/live-store");
const { emit } = await import("@/lib/events");

const SLOT: ProgramSlot = {
  fileHash: "archive:coll:psychic.mp3",
  episodeId: "coll--psychic",
  title: "Coast to Coast AM - Psychic Forecasts",
  airDate: "2004-09-25",
  guestName: null,
  showType: "coast",
  duration: 3600,
  sourceUrl: "https://archive.org/download/coll/psychic.mp3",
  kind: "on-this-date",
  start: 0,
  end: 3_600_000,
};

const schedule = {
  day: "2026-09-25",
  tz: "America/Los_Angeles",
  serverNow: 1,
  stationIdSec: 8,
  now: { slot: SLOT, startedAt: 0, offsetSec: 0, endsAt: SLOT.end },
  upNext: [],
  rest: [],
  guide: [SLOT],
  outage: false,
} as unknown as LiveSchedule;

const row = { ...episodeFromSlot(SLOT), id: 77 } as Episode;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  held.rows = [];
  prefs.deleted = [];
  stopped.n = 0;
  useLiveStore.setState({ schedule: null });
  usePlayerStore.setState({ currentEpisode: null });
});

describe("the station's show gets the library's own row", () => {
  it("when the seed lands after tuning in, the stand-in is replaced by the real row", async () => {
    useLiveStore.getState().setSchedule(schedule);
    const stop = installBrowserLiveStation();
    try {
      await flush();
      usePlayerStore.setState({ currentEpisode: episodeFromSlot(SLOT) });
      // The seed settles: now the library holds it.
      held.rows = [row];
      emit("seed-settled");
      await flush();
      expect(usePlayerStore.getState().currentEpisode).toBe(row);
    } finally {
      stop();
    }
  });

  it("a player on some other show is left alone", async () => {
    const other = episodeFromSlot({ ...SLOT, fileHash: "archive:coll:other.mp3" });
    usePlayerStore.setState({ currentEpisode: other });
    held.rows = [row];
    useLiveStore.getState().setSchedule(schedule);
    const stop = installBrowserLiveStation();
    try {
      await flush();
      expect(usePlayerStore.getState().currentEpisode).toBe(other);
    } finally {
      stop();
    }
  });
});

describe("the next show's first bytes, fetched ahead of its start", () => {
  const asked = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(new Uint8Array(8));
    }) as unknown as typeof fetch;
    return { calls, impl };
  };

  it("from where the start will go: archive.org while it is up, only the first bytes", async () => {
    archiveUpFixture();
    try {
      const { calls, impl } = asked();
      await prefetchSlotStart(SLOT, impl);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(SLOT.sourceUrl);
      expect(new Headers(calls[0].init.headers).get("range")).toBe(`bytes=0-${PREFETCH_BYTES - 1}`);
      expect(calls[0].init.credentials).toBe("omit");
    } finally {
      resetOutage();
    }
  });

  it("the mirror while archive.org is down, and nothing for a show the mirror cannot play", async () => {
    archiveDownFixture([SLOT.fileHash]);
    try {
      const { calls, impl } = asked();
      await prefetchSlotStart(SLOT, impl);
      expect(calls.map((c) => c.url)).toEqual([`/mirror/${encodeURIComponent(SLOT.fileHash)}`]);
      archiveDownFixture([]);
      await prefetchSlotStart(SLOT, impl);
      expect(calls).toHaveLength(1);
    } finally {
      resetOutage();
    }
  });

  it("a failed fetch is nothing to anyone", async () => {
    archiveUpFixture();
    try {
      await expect(prefetchSlotStart(SLOT, (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).resolves.toBeUndefined();
    } finally {
      resetOutage();
    }
  });

  it("is what the station is given to call", () => {
    const stop = installBrowserLiveStation();
    try {
      expect(typeof (held.deps as { prefetch?: unknown }).prefetch).toBe("function");
    } finally {
      stop();
    }
  });
});

describe("leaving the station", () => {
  it("stops the player and forgets the show a reload would restore", () => {
    const stop = installBrowserLiveStation();
    try {
      held.deps!.leavePlayer!();
      expect(stopped.n).toBe(1);
      expect(prefs.deleted).toEqual(["last-episode-id"]);
    } finally {
      stop();
    }
  });
});
