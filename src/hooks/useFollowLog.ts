"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";

/** How close to the bottom still counts as "at the bottom", in px. */
export const FOLLOW_SLACK_PX = 48;

export function atBottom(el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
}

/**
 * A log that follows new lines while the reader is at the bottom, and leaves
 * them alone once they have scrolled up (the phone lines, both looks).
 *
 * `followKey` changes with any new row: at the bottom, the list scrolls to it.
 * `alertKey` changes only with a new call or archive line: scrolled up, it
 * raises `unseen`, which the surface draws as "New calls below". A tune-in
 * never raises it, and the reader's own call (`alertIsMine`) takes them
 * down to it instead. `jump()` goes to the bottom and follows again.
 */
export function useFollowLog<T extends HTMLElement>(followKey: string, alertKey: string, alertIsMine = false) {
  const ref = useRef<T>(null);
  const pinned = useRef(true);
  const seenAlert = useRef(alertKey);
  const [unseen, setUnseen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [followKey]);

  useEffect(() => {
    if (alertKey === seenAlert.current) return;
    seenAlert.current = alertKey;
    if (pinned.current) return;
    // Your own call takes you down to it; anyone else's waits for you.
    // (A real scroll to the bottom fires onScroll, which clears `unseen`.)
    if (alertIsMine) {
      const el = ref.current;
      if (el) el.scrollTop = el.scrollHeight;
      pinned.current = true;
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- whether the reader is scrolled up lives in the DOM (a ref), not in React state
      setUnseen(true);
    }
  }, [alertKey, alertIsMine]);

  const onScroll = useCallback((e: UIEvent<T>) => {
    pinned.current = atBottom(e.currentTarget);
    if (pinned.current) setUnseen(false);
  }, []);

  const jump = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinned.current = true;
    setUnseen(false);
  }, []);

  return { ref, onScroll, unseen, jump };
}

/** The keys `useFollowLog` watches, from the rows a surface draws. */
export function followKeys(rows: readonly { kind: string; at: number; m?: { id: number }; a?: { id: string } }[]) {
  const last = rows[rows.length - 1];
  let alert = "";
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind === "call" && r.m) {
      alert = `c${r.m.id}`;
      break;
    }
    if (r.kind === "archive" && r.a) {
      alert = `a${r.a.id}@${r.at}`;
      break;
    }
  }
  const follow = last ? `${last.kind}-${last.at}-${rows.length}` : "";
  return { follow, alert };
}
