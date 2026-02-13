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
 * Cancels if the finger moves more than `threshold` px.
 */
export function useLongPress(
  callback: (e: React.TouchEvent) => void,
  options: UseLongPressOptions = {},
) {
  const { delay = 500, threshold = 10 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      firedRef.current = false;
      const touch = e.touches[0];
      startPos.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        callback(e);
      }, delay);
    },
    [callback, delay],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPos.current) return;
      const touch = e.touches[0];
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
      // Prevent the click event from firing if long press was triggered
      if (firedRef.current) {
        e.preventDefault();
      }
    },
    [clear],
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
