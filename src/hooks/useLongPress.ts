"use client";

import { useRef, useCallback } from "react";

interface UseLongPressOptions {
  /** Duration in ms before the callback fires (default 500) */
  delay?: number;
  /** Max movement in px before cancelling (default 10) */
  threshold?: number;
}

/**
 * Returns touch handlers that fire `callback` after a long press.
 *
 * A press is a finger held still. It is cancelled when the finger moves more
 * than `threshold` px, when the browser cancels the touch, and when anything
 * on the page scrolls while it is down. The last one matters most: once a
 * phone's browser takes a touch over for native scrolling it stops sending
 * touchmove (Chromium) or sends them late, so on a scroll the movement check
 * alone never ran and the row's menu opened mid-scroll
 * (e2e/scroll-gestures.spec.ts, 2026-10-12).
 */
export function useLongPress(
  callback: (e: React.TouchEvent) => void,
  options: UseLongPressOptions = {},
) {
  const { delay = 500, threshold = 10 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const unwatchRef = useRef<(() => void) | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    unwatchRef.current?.();
    unwatchRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      clear();
      firedRef.current = false;
      const touch = e.touches[0];
      if (!touch || e.touches.length > 1) return;
      startPos.current = { x: touch.clientX, y: touch.clientY };
      // Any scroll, of any element, while the finger is down: not a press.
      const onScroll = () => clear();
      window.addEventListener("scroll", onScroll, { capture: true, passive: true });
      unwatchRef.current = () => window.removeEventListener("scroll", onScroll, { capture: true });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        unwatchRef.current?.();
        unwatchRef.current = null;
        firedRef.current = true;
        callback(e);
      }, delay);
    },
    [callback, clear, delay],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPos.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = Math.abs(touch.clientX - startPos.current.x);
      const dy = Math.abs(touch.clientY - startPos.current.y);
      if (dx > threshold || dy > threshold) {
        clear();
      }
    },
    [clear, threshold],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      clear();
      startPos.current = null;
      // Prevent the click event from firing if long press was triggered
      if (firedRef.current) {
        e.preventDefault();
      }
    },
    [clear],
  );

  const onTouchCancel = useCallback(() => {
    clear();
    startPos.current = null;
  }, [clear]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
