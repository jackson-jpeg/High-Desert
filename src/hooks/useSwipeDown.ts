"use client";

import { useRef, useCallback, type RefObject, type TouchEvent } from "react";

interface SwipeDownOptions {
  onDismiss: () => void;
  threshold?: number;
  /** Element to translate during drag. If not provided, uses the handle element. */
  targetRef?: RefObject<HTMLElement | null>;
}

/**
 * Swipe-down-to-dismiss gesture for mobile sheets and overlays.
 * Attach swipeHandlers to the drag handle element.
 * The targetRef element (or handle itself) gets translateY during drag.
 */
export function useSwipeDown({ onDismiss, threshold = 80, targetRef }: SwipeDownOptions) {
  const startY = useRef(0);
  const currentY = useRef(0);
  const swiping = useRef(false);
  const handleRef = useRef<HTMLElement | null>(null);

  const getTarget = useCallback(() => targetRef?.current ?? handleRef.current, [targetRef]);

  const onTouchStart = useCallback((e: TouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
    swiping.current = false;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    const dy = e.touches[0].clientY - startY.current;

    // Only start swiping if moving downward
    if (!swiping.current && dy > 10) {
      swiping.current = true;
    }

    if (swiping.current) {
      currentY.current = e.touches[0].clientY;
      const clamped = Math.max(0, dy); // only allow downward drag
      const el = getTarget();
      if (el) {
        el.style.transform = `translateY(${clamped}px)`;
        el.style.transition = "none";
        // Fade opacity as user drags
        el.style.opacity = String(Math.max(0.3, 1 - clamped / 300));
      }
    }
  }, [getTarget]);

  const onTouchEnd = useCallback(() => {
    const dy = currentY.current - startY.current;
    const el = getTarget();

    if (swiping.current && dy > threshold) {
      // Dismiss — animate out then call handler
      if (el) {
        el.style.transform = `translateY(100%)`;
        el.style.opacity = "0";
        el.style.transition = "transform 0.2s ease-in, opacity 0.2s ease-in";
      }
      setTimeout(onDismiss, 200);
    } else {
      // Snap back
      if (el) {
        el.style.transform = "";
        el.style.opacity = "";
        el.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
      }
    }

    swiping.current = false;
    startY.current = 0;
    currentY.current = 0;
  }, [threshold, onDismiss, getTarget]);

  return {
    handleRef,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
