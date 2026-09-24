"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { buildListLayout, type ListLayout } from "@/lib/library/list-layout";

interface VirtualItem<T> {
  item: T;
  index: number;
  offsetTop: number;
}

interface UseVirtualListOptions<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
  /**
   * Where rows sit when group headers are interleaved (list-layout.ts). Omit
   * for a plain list of `itemHeight` rows.
   */
  layout?: ListLayout;
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
  /** The scroller's current scrollTop, as last read. */
  scrollTop: number;
  /** The layout in use — the one to ask for any row's or header's offset. */
  layout: ListLayout;
  onScroll: () => void;
  /**
   * Scroll row `index` into view. "center" (the default) is for "show me this
   * episode"; "start" puts the row directly under the column header, which is
   * what a rail entry means by "go to the start of this group".
   */
  scrollToIndex: (index: number, align?: "center" | "start") => void;
  /** Scroll so that `y` is at the top (e.g. a group header). */
  scrollToOffset: (y: number) => void;
}

export function useVirtualList<T>({
  items,
  itemHeight,
  overscan = 5,
  layout: givenLayout,
}: UseVirtualListOptions<T>): UseVirtualListReturn<T> {
  const plainLayout = useMemo(
    () => buildListLayout(items.length, [], itemHeight, 0),
    [items.length, itemHeight],
  );
  const layout = givenLayout ?? plainLayout;
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

  const totalHeight = layout.totalHeight;
  // The first row actually in view — not an overscan row (HD-035). The rows
  // start directly beneath the sticky column header, whose height cancels.
  const visibleStartIndex = items.length > 0 ? layout.rowAt(scrollTop) : 0;

  const virtualItems = useMemo(() => {
    if (items.length === 0) return [];
    const startIndex = Math.max(0, layout.rowAt(scrollTop) - overscan);
    const endIndex = Math.min(items.length - 1, layout.rowAt(scrollTop + containerHeight) + overscan);

    const result: VirtualItem<T>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        offsetTop: layout.rowTop(i),
      });
    }
    return result;
  }, [items, layout, scrollTop, overscan, containerHeight]);

  const scrollToOffset = useCallback((y: number) => {
    const el = elRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, y);
    // Programmatic scrolls fire `scroll` asynchronously; read the position
    // back now so the window and the rail do not spend a frame on the old one.
    setScrollTop(el.scrollTop);
  }, []);

  const scrollToIndex = useCallback((index: number, align: "center" | "start" = "center") => {
    const el = elRef.current;
    if (!el) return;
    const top = layout.rowTop(index);
    scrollToOffset(align === "start" ? top : top - el.clientHeight / 2 + itemHeight / 2);
  }, [layout, itemHeight, scrollToOffset]);

  return {
    containerRef,
    virtualItems,
    totalHeight,
    visibleStartIndex,
    scrollTop,
    layout,
    onScroll,
    scrollToIndex,
    scrollToOffset,
  };
}
