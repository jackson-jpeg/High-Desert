"use client";

import { useMemo } from "react";
import type { Episode } from "@/db/schema";
import { computeFacets, type LibraryFacets } from "@/lib/library/facets";

/** One pass over the catalogue per live-query update. See `computeFacets`. */
export function useLibraryFacets(allEpisodes: Episode[] | undefined): LibraryFacets {
  return useMemo(() => computeFacets(allEpisodes), [allEpisodes]);
}
