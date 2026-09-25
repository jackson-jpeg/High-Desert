"use client";

import { useEffect, useState } from "react";

/**
 * How much of the layout viewport the on-screen keyboard covers, in px.
 *
 * iOS Safari does not resize the layout viewport when the keyboard opens: a
 * `position: fixed; bottom: 0` sheet stays where it was, under the keyboard,
 * and the composer the listener is typing into disappears. The visual viewport
 * does shrink, so the covered strip is `innerHeight - (vv.height + vv.offsetTop)`.
 * The phone-lines sheet lifts itself by exactly that much.
 *
 * `offsetTop` matters: while the keyboard is up Safari may also scroll the
 * visual viewport down, and the same strip then sits partly above.
 */
export function keyboardInset(
  innerHeight: number,
  vv: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!vv) return 0;
  const inset = Math.round(innerHeight - vv.height - vv.offsetTop);
  // Sub-pixel noise and browser chrome wobble are not a keyboard.
  return inset > 40 ? inset : 0;
}

/** The current keyboard inset, tracking `visualViewport` resize and scroll. Active only while `enabled`. */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(keyboardInset(window.innerHeight, vv));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [enabled]);
  return enabled ? inset : 0;
}
