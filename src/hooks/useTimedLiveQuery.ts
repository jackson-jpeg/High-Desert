"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

/**
 * How long a screen waits on the browser's own database before it says so.
 *
 * On 2026-10-13 (docs/incident-2026-10-13/handoff.md) the Library sat on gray
 * rows and Stats on "Loading station data" for a returning visitor: both wait
 * on IndexedDB reads that never answered, most likely because another tab, or
 * the installed app, frozen by Android, held a write transaction. A read that
 * hangs never throws, so no error boundary saw it, and `useLiveQuery` stays
 * `undefined` for good. A healthy read of the whole library takes well under a
 * second, even on a slow phone; ten seconds is a hang, not slowness.
 */
export const DB_WAIT_MS = 10_000;

let waitMs = DB_WAIT_MS;
/** Tests only: a page's wait, shortened, so a page test need not sit ten seconds. */
export function setDbWaitMsForTests(ms: number | null): void {
  waitMs = ms ?? DB_WAIT_MS;
}

/**
 * `useLiveQuery` that gives up waiting: `timedOut` turns true once the first
 * answer is `DB_WAIT_MS` late, and `retry()` subscribes the query afresh (a
 * new read, a new transaction) and starts the clock again.
 *
 * A late answer still lands: the original subscription is not cancelled by the
 * timeout, so if the other tab lets go, the screen fills in on its own and
 * `timedOut` goes back to false. Retry is the listener's handle on it, and the
 * one that helps when the first read was lost rather than merely held.
 */
export function useTimedLiveQuery<T>(
  querier: () => Promise<T> | T,
  deps: readonly unknown[],
  timeoutMs?: number,
): { value: T | undefined; timedOut: boolean; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const value = useLiveQuery(querier, [...deps, attempt]);
  const timedOut = useWaitTimeout(value === undefined, timeoutMs ?? waitMs, attempt);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { value, timedOut, retry };
}

/**
 * True once `waiting` has held for `timeoutMs` without a break. Any change of
 * `restartKey` (a retry) starts the clock again; `waiting` turning false clears it.
 */
export function useWaitTimeout(waiting: boolean, timeoutMs: number = waitMs, restartKey: unknown = 0): boolean {
  // The key whose wait ran out: a new key (a retry) is not late until its own clock says so.
  const [lateFor, setLateFor] = useState<{ key: unknown } | null>(null);
  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(() => setLateFor({ key: restartKey }), timeoutMs);
    return () => window.clearTimeout(t);
  }, [waiting, timeoutMs, restartKey]);
  return waiting && lateFor !== null && lateFor.key === restartKey;
}
