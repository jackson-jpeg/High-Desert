import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nowListeningTo } from "@/hooks/usePresence";
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

  it("still works for a caller that passes no episode at all", () => {
    reportHeartbeat("session-abcdefgh");
    expect(sent[0].body).toEqual({ sessionId: "session-abcdefgh" });
  });
});
