import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * "2 Hours in the High Desert" is for two hours heard, not for being two hours
 * into a show. The dialog summed `playbackPosition` (where you are), so a
 * first-time visitor who tuned in to the live station late in a show and
 * reloaded got the milestone, and a Venmo ask over the page, within seconds.
 * Found by e2e/live-qa.spec.ts "join, refresh, resume", whose Leave click the
 * dialog covered whenever the show on air was past its second hour.
 *
 * The real component against a real (fake-indexeddb) database: the rows that
 * say "two hours in" and "two hours heard" are the ones the app writes.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { db } = await import("@/db");
const { MilestoneDialog } = await import("../MilestoneDialog");

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await db.progress.clear();
  await db.history.clear();
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Mount, and give the dialog's check (3 s after mount) time to run. */
async function mountAndWait() {
  root = createRoot(host);
  act(() => root.render(createElement(MilestoneDialog)));
  await act(() => new Promise((r) => setTimeout(r, 3_400)));
}

const shown = () => document.body.textContent?.includes("2 Hours in the High Desert") ?? false;

describe("the listening milestone", () => {
  it("is not shown to a listener who tuned in two and a half hours into a show and has heard a minute of it", async () => {
    await db.progress.put({ fileHash: "archive:x:live.mp3", playbackPosition: 9_000, lastPlayedAt: Date.now() });
    await db.history.add({ episodeId: 1, timestamp: Date.now(), duration: 60 });
    await mountAndWait();
    expect(shown()).toBe(false);
  }, 10_000);

  it("is shown once two hours have actually been heard, even with no position saved anywhere", async () => {
    // Two finished shows: `ended` clears the position, the time heard stays.
    await db.history.bulkAdd([
      { episodeId: 1, timestamp: 1, duration: 3_600 },
      { episodeId: 2, timestamp: 2, duration: 3_700 },
    ]);
    await mountAndWait();
    expect(shown()).toBe(true);
  }, 10_000);
});
