import { create } from "zustand";
import type { Progress } from "@/db/schema";

/**
 * Where the listener is in each episode, in memory: a mirror of the Dexie
 * `progress` table (HD-016), kept current by `startProgressSync()`
 * (src/services/episodes/progress.ts) and written through by `writeProgress()`.
 *
 * Why a store and not a live query per reader:
 *
 *   - **The player must read a position synchronously.** `playEpisode()` may
 *     not await anything before `play()` — that task boundary is how Safari
 *     decides a call was not user-initiated — so the start position comes from
 *     here, never from IndexedDB.
 *   - **A position save must not re-render the library.** Rows select their own
 *     entry (`useProgress`), and an entry keeps its object identity until its
 *     own numbers change, so a 30 s save re-renders the one row that is playing
 *     rather than 1,312.
 *
 * Keyed by `fileHash`, the episode's identity (src/db/identity.ts) — see the
 * `progress` table in src/db/index.ts for why not the numeric id.
 */
export type ProgressIndex = ReadonlyMap<string, Progress>;

export const NO_PROGRESS: ProgressIndex = new Map();
const NO_STARTED: ReadonlySet<string> = new Set();

type ProgressFields = Partial<Omit<Progress, "fileHash">>;

interface ProgressState {
  byHash: ProgressIndex;
  /**
   * Hashes with a saved position above 0. The same Set instance until its
   * membership changes, so "unlistened" lists do not rebuild on every save.
   */
  started: ReadonlySet<string>;
  /** The table has been read at least once. */
  loaded: boolean;
  /** Replace the index with the table's contents, keeping unchanged entries' identity. */
  replaceAll: (rows: readonly Progress[]) => void;
  /** Merge `fields` into one entry — as a new object, never written into the old one. */
  patch: (fileHash: string, fields: ProgressFields) => void;
  reset: () => void;
}

function sameEntry(a: Progress, b: Progress): boolean {
  return a.playbackPosition === b.playbackPosition && a.lastPlayedAt === b.lastPlayedAt;
}

function startedOf(byHash: ProgressIndex, prev: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set<string>();
  for (const [hash, p] of byHash) if ((p.playbackPosition ?? 0) > 0) next.add(hash);
  if (next.size === prev.size && [...next].every((h) => prev.has(h))) return prev;
  return next;
}

export const useProgressStore = create<ProgressState>((set, get) => ({
  byHash: NO_PROGRESS,
  started: NO_STARTED,
  loaded: false,

  replaceAll: (rows) => {
    const { byHash: prev, started, loaded } = get();
    const next = new Map<string, Progress>();
    let changed = rows.length !== prev.size;
    for (const row of rows) {
      const old = prev.get(row.fileHash);
      if (old && sameEntry(old, row)) {
        next.set(row.fileHash, old);
      } else {
        next.set(row.fileHash, row);
        changed = true;
      }
    }
    if (!changed) {
      if (!loaded) set({ loaded: true });
      return;
    }
    set({ byHash: next, started: startedOf(next, started), loaded: true });
  },

  patch: (fileHash, fields) => {
    const { byHash: prev, started } = get();
    const old = prev.get(fileHash);
    const entry: Progress = { ...old, ...fields, fileHash };
    if (old && sameEntry(old, entry)) return;
    const next = new Map(prev);
    next.set(fileHash, entry);
    set({ byHash: next, started: startedOf(next, started) });
  },

  reset: () => set({ byHash: NO_PROGRESS, started: NO_STARTED, loaded: false }),
}));

/** The saved entry for one episode, read synchronously. */
export function progressOf(fileHash: string | undefined): Progress | undefined {
  return fileHash ? useProgressStore.getState().byHash.get(fileHash) : undefined;
}

/** The saved position for one episode, read synchronously (the player's start path). */
export function positionOf(fileHash: string | undefined): number | undefined {
  return progressOf(fileHash)?.playbackPosition;
}

/** One row's entry. Re-renders only when that entry changes. */
export function useProgress(fileHash: string | undefined): Progress | undefined {
  return useProgressStore((s) => (fileHash ? s.byHash.get(fileHash) : undefined));
}

/**
 * The whole index — for the few readers that order or filter by it (the
 * "Recently played" and "In progress" sorts). Pass `enabled: false` when the
 * current view does not need it, and the caller stops re-rendering on saves.
 */
export function useProgressIndex(enabled = true): ProgressIndex {
  return useProgressStore((s) => (enabled ? s.byHash : NO_PROGRESS));
}

/** Hashes with a saved position; identity changes only with membership. */
export function useStartedHashes(): ReadonlySet<string> {
  return useProgressStore((s) => s.started);
}
