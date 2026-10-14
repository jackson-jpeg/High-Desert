import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Nothing spins forever (2026-10-13, docs/incident-2026-10-13/handoff.md).
 *
 * The Library and Stats waited on IndexedDB reads that never answered, and a
 * hanging read never throws, so nothing saw it. `useTimedLiveQuery` gives up
 * after a deadline, says so, and its Retry reads again.
 *
 * Two kinds of hang, both real:
 *   - a querier whose promise never settles (the read that was lost);
 *   - **another tab holding a write transaction**: a second, raw IndexedDB
 *     connection to the same database keeps a readwrite transaction over
 *     `episodes` alive, which is what a frozen Android tab does. Our read is
 *     queued behind it by IndexedDB itself, not by anything in this test.
 *
 * Each has a control: the same screen with nothing holding the database never
 * reports a timeout, so "timed out" is evidence of the hold, not of a clock
 * that fires regardless.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { db } = await import("@/db");
const { useTimedLiveQuery } = await import("@/hooks/useTimedLiveQuery");

const WAIT = 150;

type Seen = { value: unknown; timedOut: boolean; retry: () => void };
const box: { seen: Seen | null } = { seen: null };
let root: Root;
let host: HTMLDivElement;

function Probe({ querier }: { querier: () => Promise<unknown> }) {
  const result = useTimedLiveQuery(querier, [], WAIT);
  useEffect(() => {
    box.seen = result;
  });
  return null;
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function mount(querier: () => Promise<unknown>) {
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe, { querier })));
}

/**
 * The other tab: its own connection, a readwrite transaction over `episodes`
 * kept alive by issuing a request whenever the last one finishes (an
 * IndexedDB transaction commits as soon as it has nothing pending).
 */
async function holdEpisodesForWriting(): Promise<{ release: () => Promise<void> }> {
  const conn = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(db.name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  let holding = true;
  const tx = conn.transaction(["episodes"], "readwrite");
  const done = new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
  });
  const store = tx.objectStore("episodes");
  const spin = () => {
    if (!holding) return;
    store.count().onsuccess = spin;
  };
  spin();
  return {
    release: async () => {
      holding = false;
      await done;
      conn.close();
    },
  };
}

beforeEach(async () => {
  await db.open();
  await db.episodes.clear();
  await db.episodes.bulkAdd([
    { fileHash: "archive:c:a.mp3", fileName: "a.mp3", filePath: "", fileSize: 0, title: "A", source: "archive", createdAt: 0, updatedAt: 0 },
    { fileHash: "archive:c:b.mp3", fileName: "b.mp3", filePath: "", fileSize: 0, title: "B", source: "archive", createdAt: 0, updatedAt: 0 },
  ] as never);
});

afterEach(async () => {
  await act(async () => root?.unmount());
});

describe("useTimedLiveQuery: a read that never answers", () => {
  it("times out, and Retry reads again and recovers", async () => {
    let calls = 0;
    const querier = () => {
      calls++;
      // The first read is lost; the retry's answers.
      return calls === 1 ? new Promise<number>(() => {}) : Promise.resolve(42);
    };
    await mount(querier);
    expect(box.seen!.value).toBeUndefined();
    expect(box.seen!.timedOut).toBe(false);
    await wait(WAIT + 50);
    expect(box.seen!.timedOut).toBe(true);

    await act(async () => box.seen!.retry());
    await wait(30);
    expect(calls).toBe(2);
    expect(box.seen!.value).toBe(42);
    expect(box.seen!.timedOut).toBe(false);
  });

  it("control: a read that answers never reports a timeout", async () => {
    await mount(() => Promise.resolve(7));
    await wait(WAIT + 80);
    expect(box.seen!.value).toBe(7);
    expect(box.seen!.timedOut).toBe(false);
  });

  it("a late answer clears the timeout on its own", async () => {
    let resolveLate: (v: number) => void = () => {};
    await mount(() => new Promise<number>((r) => (resolveLate = r)));
    await wait(WAIT + 50);
    expect(box.seen!.timedOut).toBe(true);
    await act(async () => resolveLate(5));
    await wait(10);
    expect(box.seen!.value).toBe(5);
    expect(box.seen!.timedOut).toBe(false);
  });
});

describe("useTimedLiveQuery: another tab holds a write transaction", () => {
  it("the read waits behind it, the screen times out, and Retry recovers once it lets go", async () => {
    const other = await holdEpisodesForWriting();
    await mount(() => db.episodes.count());
    await wait(WAIT + 80);
    // IndexedDB queued our read behind the other connection's readwrite.
    expect(box.seen!.value).toBeUndefined();
    expect(box.seen!.timedOut).toBe(true);

    // Retry while still held: no false recovery, it times out again.
    await act(async () => box.seen!.retry());
    await wait(20);
    expect(box.seen!.timedOut).toBe(false);
    await wait(WAIT + 80);
    expect(box.seen!.value).toBeUndefined();
    expect(box.seen!.timedOut).toBe(true);

    await other.release();
    await act(async () => box.seen!.retry());
    await wait(60);
    expect(box.seen!.value).toBe(2);
    expect(box.seen!.timedOut).toBe(false);
  });

  it("control: with nothing holding the database the same read answers at once", async () => {
    await mount(() => db.episodes.count());
    await wait(WAIT + 80);
    expect(box.seen!.value).toBe(2);
    expect(box.seen!.timedOut).toBe(false);
  });
});
