"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A flag that `poke()` raises and that drops by itself `idleMs` after the last
 * poke. The mobile year scrubber uses it to appear while the list scrolls and
 * fade once it stops, the way the iOS Photos scrubber does.
 *
 * Driven from event handlers (a scroll, the end of a drag), never from an
 * effect, so it costs no extra render pass.
 */
export function useWakeFlag(idleMs: number): [awake: boolean, poke: () => void] {
  const [awake, setAwake] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poke = useCallback(() => {
    setAwake(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), idleMs);
  }, [idleMs]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return [awake, poke];
}
