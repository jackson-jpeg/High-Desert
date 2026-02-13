"use client";

import { useState, useMemo, useCallback, type RefObject } from "react";

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
}

export function useVirtualList<T>({
  items,
  itemHeight,
  containerRef,
  overscan = 5,
}: UseVirtualListOptions<T>): UseVirtualListReturn<T> {
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, [containerRef]);

  const totalHeight = items.length * itemHeight;

  const virtualItems = useMemo(() => {
    const container = containerRef.current;
    const containerHeight = container?.clientHeight ?? 600;

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
  }, [items, itemHeight, scrollTop, overscan, containerRef]);

  return { virtualItems, totalHeight, onScroll };
}
