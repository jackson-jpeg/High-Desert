"use client";

import { useState, useEffect } from "react";

export function useMediaQuery(query: string): boolean {
  // Always start false to match server render and avoid hydration mismatch (React #418)
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Returns true when viewport is below Tailwind `md:` (768px) */
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 768px)");
}
