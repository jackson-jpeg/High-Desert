"use client";

import { useSyncExternalStore } from "react";
import { readSeason, type Season } from "@/lib/season/season";

const never = () => () => {};

/**
 * The holiday season the page is dressed for (`<html data-season>`, set
 * before first paint by SEASON_SCRIPT). Null on the server and through
 * hydration, so the first client render matches the server's.
 */
export function useSeason(): Season | null {
  return useSyncExternalStore(never, () => readSeason(), () => null);
}
