"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { firstVisibleIndex } from "@/lib/library/rail-groups";

interface VirtualItem<T> {
  item: T;
  index: number;
  offsetTop: number;
}

interface UseVirtualListOptions<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
}

interface UseVirtualListReturn<T> {
  /**
   * Callback ref for the scrolling element. A callback rather than a ref
   * object, so the hook learns when the element actually mounts (HD-035).
   */
  containerRef: (el: HTMLElement | null) => void;
  virtualItems: VirtualItem<T>[];
  totalHeight: number;
  /** Index of the first row in view — excludes the overscan rows rendered above it. */
  visibleStartIndex: number;
  onScroll: () => void;
  /**
   * Scroll row `index` into view. "center" (the default) is for "show me this
   * episode"; "start" puts the row directly under the column header, which is
   * what a rail entry means by "go to the start of this group".
   */
  scrollToIndex: (index: number, align?: "center" | "start") => void;
}

export function useVirtualList<T>({
  items,
  itemHeight,
  overscan = 5,
}: UseVirtualListOptions<T>): UseVirtualListReturn<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  // The element, as state: an effect keyed on it re-runs when it mounts.
  // This used to take a `RefObject` and observe `ref.current` in an effect
  // keyed on the ref object — which never changes — so when the first render
  // had no scroller (TimelineView's empty state renders none), the observer
  // was never attached and the list never learned its real height (HD-035).
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const elRef = useRef<HTMLElement | null>(null);

  const containerRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    setContainer(el);
    if (el) {
      // A remounted scroller starts at its own scrollTop (0), not the last one's.
      setScrollTop(el.scrollTop);
      if (el.clientHeight > 0) setContainerHeight(el.clientHeight);
    }
  }, []);

  // Track container size with ResizeObserver
  useEffect(() => {
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) setContainerHeight(h);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [container]);

  const onScroll = useCallback(() => {
    const el = elRef.current;
    if (el) {
      setScrollTop(el.scrollTop);
    }
  }, []);

  const totalHeight = items.length * itemHeight;
  const visibleStartIndex = firstVisibleIndex(scrollTop, itemHeight, items.length);

  const virtualItems = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan,
    );

    const result: VirtualItem<T>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        offsetTop: i * itemHeight,
      });
    }
    return result;
  }, [items, itemHeight, scrollTop, overscan, containerHeight]);

  const scrollToIndex = useCallback((index: number, align: "center" | "start" = "center") => {
    const el = elRef.current;
    if (!el) return;
    el.scrollTop = align === "start"
      ? Math.max(0, index * itemHeight)
      : Math.max(0, index * itemHeight - el.clientHeight / 2 + itemHeight / 2);
    // Programmatic scrolls fire `scroll` asynchronously; read the position
    // back now so the window and the rail do not spend a frame on the old one.
    setScrollTop(el.scrollTop);
  }, [itemHeight]);

  return { containerRef, virtualItems, totalHeight, visibleStartIndex, onScroll, scrollToIndex };
}
