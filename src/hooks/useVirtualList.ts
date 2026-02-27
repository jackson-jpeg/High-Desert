"use client";

import { useState, useMemo, useCallback, useEffect, type RefObject } from "react";

interface VirtualItem<T> {
  item: T;
  index: number;
  offsetTop: number;
}

interface UseVirtualListOptions<T> {
  items: T[];
  itemHeight: number;
  containerRef: RefObject<HTMLElement | null>;
  overscan?: number;
}

interface UseVirtualListReturn<T> {
  virtualItems: VirtualItem<T>[];
  totalHeight: number;
  onScroll: () => void;
  scrollToIndex: (index: number) => void;
}

export function useVirtualList<T>({
  items,
  itemHeight,
  containerRef,
  overscan = 5,
}: UseVirtualListOptions<T>): UseVirtualListReturn<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Track container size with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerHeight(el.clientHeight);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) setContainerHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      setScrollTop(el.scrollTop);
    }
  }, [containerRef]);

  const totalHeight = items.length * itemHeight;

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

  const scrollToIndex = useCallback((index: number) => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = Math.max(0, index * itemHeight - el.clientHeight / 2 + itemHeight / 2);
    }
  }, [containerRef, itemHeight]);

  return { virtualItems, totalHeight, onScroll, scrollToIndex };
}
