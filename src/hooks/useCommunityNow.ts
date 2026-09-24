"use client";

import { useSyncExternalStore } from "react";
import {
  getNowSnapshot,
  getServerNowSnapshot,
  subscribeNow,
  type NowSnapshot,
} from "@/services/stats/now-feed";

/**
 * Presence and what is on air, from the one shared feed
 * (`src/services/stats/now-feed.ts`). Every surface that shows how many people
 * are here reads this and nothing else.
 */
export function useCommunityNow(): NowSnapshot {
  return useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
}
