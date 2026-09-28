import { describe, expect, it } from "vitest";
import { INITIAL_LIVE, liveReducer } from "@/hooks/useLiveChat";
import type { LiveMessage, LiveYou, SlowMode } from "@/services/live/client";

/**
 * A call reaches the caller's own screen up to three times: the POST's 201,
 * the SSE echo of the same message, and a replay after a reconnect (a
 * resumed hello's `recent`). It must be on screen once.
 *
 * Asked after CI showed one call's text twice on the mobile rename test
 * (2026-09-28): those were two different callers (the desktop and mobile
 * runs) posting the same 3-word token into one room, not one call drawn
 * twice. This holds the part a real listener depends on.
 */
const you: LiveYou = { name: "Night Clerk", line: "Line 1", admin: false };
const slowMode: SlowMode = { on: false, until: null, intervalMs: 0, forced: false };
const msg = (id: number, body = `call ${id}`): LiveMessage => ({ id, at: new Date(1_700_000_000_000 + id).toISOString(), name: "Night Clerk", line: "Line 1", body });

describe("a call is on screen once", () => {
  it("the POST's 201, then its SSE echo, then a resumed replay", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "hello", you, slowMode, recent: [msg(1)], resumed: false, hidden: [] });
    s = liveReducer(s, { type: "message", message: msg(2), mine: true });
    s = liveReducer(s, { type: "message", message: msg(2) });
    s = liveReducer(s, { type: "hello", you, slowMode, recent: [msg(1), msg(2)], resumed: true, hidden: [] });
    expect(s.messages.map((m) => m.id)).toEqual([1, 2]);
    expect(s.mine).toEqual([2]);
  });

  it("the echo arriving before the POST's answer", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "message", message: msg(7) });
    s = liveReducer(s, { type: "message", message: msg(7), mine: true });
    expect(s.messages.map((m) => m.id)).toEqual([7]);
  });

  it("two callers' calls with the same words are two lines (control)", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "message", message: msg(3, "same words") });
    s = liveReducer(s, { type: "message", message: msg(4, "same words") });
    expect(s.messages.map((m) => m.id)).toEqual([3, 4]);
  });
});
