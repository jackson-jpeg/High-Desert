"use client";

import { useRef, useCallback, type TouchEvent } from "react";

interface SwipeActions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  threshold?: number;
}

interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  swiping: boolean;
}

export function useSwipeAction({ onSwipeRight, onSwipeLeft, threshold = 60 }: SwipeActions) {
  const stateRef = useRef<SwipeState>({ startX: 0, startY: 0, currentX: 0, swiping: false });
  const elRef = useRef<HTMLDivElement | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    stateRef.current = { startX: touch.clientX, startY: touch.clientY, currentX: touch.clientX, swiping: false };
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    const state = stateRef.current;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    // If vertical scroll dominates, bail
    if (!state.swiping && Math.abs(dy) > Math.abs(dx)) return;

    if (Math.abs(dx) > 10) {
      state.swiping = true;
    }

    if (state.swiping && elRef.current) {
      state.currentX = touch.clientX;
      const clamped = Math.max(-120, Math.min(120, dx));
      elRef.current.style.transform = `translateX(${clamped}px)`;
      elRef.current.style.transition = "none";
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const state = stateRef.current;
    const dx = state.currentX - state.startX;

    if (elRef.current) {
      elRef.current.style.transform = "";
      elRef.current.style.transition = "transform 0.2s ease-out";
    }

    if (state.swiping) {
      if (dx > threshold && onSwipeRight) {
        onSwipeRight();
      } else if (dx < -threshold && onSwipeLeft) {
        onSwipeLeft();
      }
    }

    stateRef.current = { startX: 0, startY: 0, currentX: 0, swiping: false };
  }, [threshold, onSwipeRight, onSwipeLeft]);

  return {
    ref: elRef,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    getSwipeBgStyle: (dx: number) => ({
      background: dx > 0 ? "rgba(74, 222, 128, 0.15)" : "rgba(212, 168, 67, 0.15)",
    }),
  };
}
