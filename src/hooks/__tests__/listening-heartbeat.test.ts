import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nowListeningTo, tunedInLive } from "@/hooks/usePresence";
import { useLiveStore } from "@/stores/live-store";
import { reportHeartbeat } from "@/services/stats/client";
import { usePlayerStore } from "@/stores/player-store";
import type { Episode } from "@/db/schema";

/**
 * "On air" has to keep meaning "being listened to".
 *
 * `active_sessions.listening_at` was written once, by recordPlay, and never
 * again — while the on-air query filters on `listening_at >= now() - 5 minutes`.
 * So a show left the on-air list five minutes after somebody pressed play and
 * stayed off it for the remaining two hours and fifty-five minutes of the
 * broadcast. The list was measuring who had *started* something recently.
 *
 * The heartbeat every tab already sends is the fix: while playback is running
 * it carries the episode, which renews the mark. This covers the client half —
 * that the id is sent when and only when something is actually playing.
 */

function makeEpisode(over: Partial<Episode> = {}): Episode {
  return {
    id: 3,
    fileHash: "archive:coll:show.mp3",
    fileName: "2005-09-18_-_Coast_to_Coast_AM.mp3",
    archiveIdentifier: "ultimate-art-bell-collection",
    title: "EVP in the House",
    sourceUrl: "https://archive.org/download/coll/show.mp3",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

describe("what the heartbeat says this tab is listening to", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentEpisode: null,
      playing: false,
      queue: [],
      queueIndex: -1,
    });
  });

  it("names the episode while it is playing", () => {
    usePlayerStore.setState({ currentEpisode: makeEpisode(), playing: true });
    expect(nowListeningTo()).toBe(
      "ultimate-art-bell-collection--2005-09-18_-_Coast_to_Coast_AM",
    );
  });

  it("says nothing while paused", () => {
    // A paused tab stops renewing and decays out of the window on its own. It
    // must not be reported as listening, or "on air" becomes "has a show open".
    usePlayerStore.setState({ currentEpisode: makeEpisode(), playing: false });
    expect(nowListeningTo()).toBeNull();
  });

  it("says nothing when no show is loaded at all", () => {
    usePlayerStore.setState({ currentEpisode: null, playing: true });
    expect(nowListeningTo()).toBeNull();
  });

  it("says nothing for a local file, which has no community identity", () => {
    usePlayerStore.setState({
      currentEpisode: makeEpisode({ archiveIdentifier: undefined }),
      playing: true,
    });
    expect(nowListeningTo()).toBeNull();
  });
});

describe("whether the heartbeat says this tab is tuned in live", () => {
  beforeEach(() => {
    usePlayerStore.setState({ currentEpisode: makeEpisode(), playing: false });
    useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null });
  });
  afterEach(() => {
    useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null });
  });

  it("tuned in and playing: live", () => {
    useLiveStore.setState({ tuned: true, phase: "show" });
    usePlayerStore.setState({ playing: true });
    expect(tunedInLive()).toBe(true);
  });

  it("in the station ID between shows, when nothing is playing: still live", () => {
    // The eight seconds of static between two shows must not drop a listener
    // from the live count for the minute until the next beat.
    useLiveStore.setState({ tuned: true, phase: "station-id" });
    usePlayerStore.setState({ playing: false });
    expect(tunedInLive()).toBe(true);
  });

  it("tuned in but paused (or stalled out): not live", () => {
    useLiveStore.setState({ tuned: true, phase: "show" });
    usePlayerStore.setState({ playing: false });
    expect(tunedInLive()).toBe(false);
  });

  it("held paused, even in the station ID: not live", () => {
    // Held means the listener stopped listening; the station ID's exemption
    // is for the eight seconds between shows, not for a paused station.
    useLiveStore.setState({ tuned: true, paused: true, phase: "station-id" });
    expect(tunedInLive()).toBe(false);
  });

  it("playing an ordinary show, not tuned in: not live", () => {
    usePlayerStore.setState({ playing: true });
    expect(tunedInLive()).toBe(false);
  });
});

describe("reportHeartbeat", () => {
  let sent: { url: string; body: unknown }[];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Promise.resolve(new Response("{}"));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the episode when one is playing", () => {
    reportHeartbeat("session-abcdefgh", "coll--some-show");
    expect(sent[0].url).toBe("/api/stats/heartbeat");
    expect(sent[0].body).toEqual({
      sessionId: "session-abcdefgh",
      episodeId: "coll--some-show",
    });
  });

  it("omits the key entirely when nothing is playing", () => {
    // Not `episodeId: null` — the server treats an absent id as "leave the
    // listening mark alone", which is what stops a pause from yanking a show
    // off the air mid-broadcast.
    reportHeartbeat("session-abcdefgh", null);
    expect(sent[0].body).toEqual({ sessionId: "session-abcdefgh" });
  });

  it("says live only when tuned in, and omits the key otherwise", () => {
    reportHeartbeat("session-abcdefgh", "coll--some-show", true);
    expect(sent[0].body).toEqual({
      sessionId: "session-abcdefgh",
      episodeId: "coll--some-show",
      live: true,
    });
    reportHeartbeat("session-abcdefgh", "coll--some-show", false);
    expect(sent[1].body).toEqual({ sessionId: "session-abcdefgh", episodeId: "coll--some-show" });
  });

  it("still works for a caller that passes no episode at all", () => {
    reportHeartbeat("session-abcdefgh");
    expect(sent[0].body).toEqual({ sessionId: "session-abcdefgh" });
  });
});
