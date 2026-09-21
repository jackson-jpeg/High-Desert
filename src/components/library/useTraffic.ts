"use client";

import { useEffect, useState } from "react";
import { fetchTraffic, type Traffic } from "@/services/stats/client";
import type { TrafficRange } from "@/lib/library/traffic";

/**
 * Traffic history for one range. The previous range's answer stays in
 * `traffic` while the next one loads, so switching ranges does not flash the
 * loading frame; a response for a range the panel has already left is dropped.
 */
export function useTraffic(range: TrafficRange): { traffic: Traffic | null; loading: boolean } {
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- sync loading state before async fetch
    fetchTraffic(range)
      .then((t) => {
        if (!cancelled) setTraffic(t);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return { traffic, loading };
}
