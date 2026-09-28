import { afterEach, describe, expect, it } from "vitest";
import { claimLiveListen, setLiveStart, __testing } from "@/audio/live-session";

/**
 * One listen per airing survives a reload of the tab. A tab now reloads itself
 * onto a new build (src/services/build/stale-tab.ts); a listener held on the
 * station comes back to the same airing, and that must not count twice.
 */

const A = { fileHash: "archive:c:a.mp3", slotKey: "1000:archive:c:a.mp3", startAt: () => 0 };
const B = { fileHash: "archive:c:b.mp3", slotKey: "9000:archive:c:b.mp3", startAt: () => 0 };

afterEach(() => __testing.reset());

describe("claimLiveListen across a reload", () => {
  it("an airing counted before a reload is not counted again after it", () => {
    setLiveStart(A);
    expect(claimLiveListen(A)).toBe(true);
    __testing.reload();
    setLiveStart(A);
    expect(claimLiveListen(A)).toBe(false);
  });

  it("the next airing still counts once (control: the reload did not stop counting)", () => {
    setLiveStart(A);
    claimLiveListen(A);
    __testing.reload();
    setLiveStart(B);
    expect(claimLiveListen(B)).toBe(true);
    expect(claimLiveListen(B)).toBe(false);
  });

  it("unreadable storage is an empty memory, not an error", () => {
    sessionStorage.setItem("hd-live-counted", "{not json");
    __testing.reload();
    setLiveStart(A);
    expect(claimLiveListen(A)).toBe(true);
  });
});
