"use client";

import { useEffect, useRef } from "react";

const KONAMI = [
  "ArrowUp", "ArrowUp",
  "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight",
  "ArrowLeft", "ArrowRight",
  "KeyB", "KeyA",
];

/** Calls `onActivate` when the Konami code is entered. */
export function useKonamiCode(onActivate: () => void) {
  const posRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Reset after 3s of inactivity
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { posRef.current = 0; }, 3000);

      if (e.code === KONAMI[posRef.current]) {
        posRef.current++;
        if (posRef.current === KONAMI.length) {
          posRef.current = 0;
          onActivate();
        }
      } else {
        posRef.current = 0;
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(timerRef.current);
    };
  }, [onActivate]);
}
