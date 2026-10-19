"use client";

import { useEffect, useState } from "react";
import {
  fetchRecords,
  fetchTuningIn,
  fetchVisitorStats,
  type Attribution,
  type StationRecords,
  type TuneInEntry,
  type VisitorStats,
} from "@/services/stats/client";

/** Visitors and places move slowly; the feed is the live part. */
export const VISITORS_POLL_MS = 60_000;
export const TUNING_IN_POLL_MS = 30_000;
export const RECORDS_POLL_MS = 5 * 60_000;

export interface Listeners {
  visitors: VisitorStats | null;
  tuneIns: TuneInEntry[];
  records: StationRecords | null;
  attribution: Attribution | null;
  loading: boolean;
}

/**
 * The Listeners panel's three reads (docs/visitors.md), each on its own clock,
 * none while the tab is hidden: coming back on screen reads all three at once.
 */
export function useListeners(): Listeners {
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);
  const [tuneIns, setTuneIns] = useState<TuneInEntry[]>([]);
  const [feedAttribution, setFeedAttribution] = useState<Attribution | null>(null);
  const [records, setRecords] = useState<StationRecords | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const readVisitors = () => fetchVisitorStats().then((v) => !cancelled && v && setVisitors(v));
    const readFeed = () =>
      fetchTuningIn().then((f) => {
        if (cancelled) return;
        setTuneIns(f.entries);
        setFeedAttribution(f.attribution);
      });
    const readRecords = () => fetchRecords().then((r) => !cancelled && r && setRecords(r));
    const all = () => Promise.all([readVisitors(), readFeed(), readRecords()]);

    all().finally(() => !cancelled && setLoading(false));
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const timers = [
      setInterval(() => visible() && readVisitors(), VISITORS_POLL_MS),
      setInterval(() => visible() && readFeed(), TUNING_IN_POLL_MS),
      setInterval(() => visible() && readRecords(), RECORDS_POLL_MS),
    ];
    const onShow = () => visible() && void all();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      cancelled = true;
      timers.forEach(clearInterval);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  return { visitors, tuneIns, records, attribution: visitors?.attribution ?? feedAttribution, loading };
}
