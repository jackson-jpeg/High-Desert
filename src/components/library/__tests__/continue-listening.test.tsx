import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * Continue listening, mounted for real against the database: the progress
 * table and the episode rows (HD-016), read the way the Library reads them.
 * The tap hands the episode to `onResume` (the Library's play-episode emit,
 * which resumes at the saved second through the ordinary play path).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { db } = await import("@/db");
const { ContinueListening } = await import("@/components/library/ContinueListening");

let root: Root;
let host: HTMLDivElement;

const row = (n: number, duration = 3 * 3600) =>
  ({
    fileHash: `archive:coll:1997-0${n}-01 - Show ${n}.mp3`,
    fileName: `1997-0${n}-01 - Show ${n}.mp3`,
    title: `Coast to Coast AM - Show ${n}`,
    guestName: `Guest ${n}`,
    airDate: `1997-0${n}-01`,
    duration,
    archiveIdentifier: "coll",
  }) as Episode;

async function seed(rows: { ep: Episode; at: number; lastPlayedAt: number }[]) {
  for (const r of rows) {
    await db.episodes.add(r.ep);
    await db.progress.put({ fileHash: r.ep.fileHash, playbackPosition: r.at, lastPlayedAt: r.lastPlayedAt });
  }
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
}

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(async () => {
  await db.episodes.clear();
  await db.progress.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Continue listening", () => {
  it("is not there when there is nothing to continue", async () => {
    await seed([{ ep: row(1), at: 20, lastPlayedAt: 5 }]); // a 20 s sample
    act(() => root.render(<ContinueListening onResume={vi.fn()} />));
    await flush();
    expect(q("continue-listening")).toBeNull();
  });

  it("leads with the show stopped most recently, and one tap resumes that show", async () => {
    await seed([
      { ep: row(1), at: 600, lastPlayedAt: 10 },
      { ep: row(2), at: 3600 + 12 * 60 + 4, lastPlayedAt: 20 },
      { ep: row(3), at: 900, lastPlayedAt: 5 },
    ]);
    const onResume = vi.fn();
    act(() => root.render(<ContinueListening onResume={onResume} />));
    await flush();
    const featured = q("continue-resume")!;
    expect(featured.getAttribute("aria-label")).toBe("Resume Coast to Coast AM - Show 2 at 1:12:04");
    expect(q("continue-at")!.textContent).toBe("Resume at 1:12:04");
    expect(featured.textContent).toContain("Guest 2 · 1997");
    expect(featured.textContent).toContain("1 h 48 min left");
    expect(host.querySelectorAll('[data-testid="continue-more"]')).toHaveLength(2);
    expect(host.textContent).not.toMatch(/—/);
    act(() => featured.click());
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume.mock.calls[0][0].fileHash).toBe(row(2).fileHash);
  });

  it("leaves out the show already in the player", async () => {
    await seed([{ ep: row(1), at: 600, lastPlayedAt: 10 }]);
    act(() => root.render(<ContinueListening onResume={vi.fn()} exclude={row(1).fileHash} />));
    await flush();
    expect(q("continue-listening")).toBeNull();
  });

  it("follows the progress table: a show finished meanwhile drops out", async () => {
    await seed([{ ep: row(1), at: 600, lastPlayedAt: 10 }]);
    act(() => root.render(<ContinueListening onResume={vi.fn()} />));
    await flush();
    expect(q("continue-resume")).not.toBeNull();
    await act(async () => {
      await db.progress.put({ fileHash: row(1).fileHash, playbackPosition: 0, lastPlayedAt: 11 });
    });
    await flush();
    expect(q("continue-listening")).toBeNull();
  });

  it("can be put away for the visit", async () => {
    await seed([{ ep: row(1), at: 600, lastPlayedAt: 10 }]);
    act(() => root.render(<ContinueListening onResume={vi.fn()} />));
    await flush();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Hide Continue listening"]')!.click());
    expect(q("continue-listening")).toBeNull();
  });
});
