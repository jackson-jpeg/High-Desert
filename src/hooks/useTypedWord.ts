"use client";

import { useEffect, useRef } from "react";
import { isKeyOwnedByTarget } from "@/lib/utils/key-ownership";
import { typeKey } from "@/components/looks/win98/start-menu";

/**
 * Calls `onWord` when `word` is typed on a keyboard with nothing focused that
 * owns its keys (no field, no button). Keys typed one at a time only: a
 * held key's repeats and an IME's composition never count, and a phone's
 * on-screen keyboard only ever types into a field. No gesture can type, so
 * nothing a thumb does on a screen opens what this guards.
 *
 * Night's way into Mel's Hole (DesktopShell). Win98's Taskbar has its own,
 * beside Ctrl+Esc, and opens the Win98 program instead.
 */
export function useTypedWord(word: string, onWord: () => void, enabled = true): void {
  const latest = useRef(onWord);
  useEffect(() => {
    latest.current = onWord;
  });
  useEffect(() => {
    if (!enabled) return;
    let progress = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || e.key.length !== 1) return;
      if (isKeyOwnedByTarget(e)) {
        progress = 0;
        return;
      }
      const r = typeKey(progress, e.key, word);
      progress = r.progress;
      if (r.done) latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [word, enabled]);
}
