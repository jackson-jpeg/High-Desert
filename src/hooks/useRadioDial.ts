"use client";

import { useMemo, useEffect, useRef, useCallback } from "react";
import type { Episode } from "@/db/schema";
import { useRadioDialStore } from "@/stores/radio-dial-store";

// ---------- Types ----------

export interface DialStation {
  dayIndex: number;
  dateStr: string;
  frequency: number; // 530-1700 kHz (decorative)
  episode: Episode;
  showType: string;
  isNotable: boolean;
}

export interface StationIndex {
  stations: DialStation[];
  earliest: Date;
  latest: Date;
  totalDays: number;
  /** All unique years in the archive */
  years: number[];
  /** Map from dayIndex → array of stations at that day */
  byDay: Map<number, DialStation[]>;
}

// ---------- Helpers ----------

const MS_PER_DAY = 86_400_000;

function dateToDayIndex(date: Date, earliest: Date): number {
  return Math.round((date.getTime() - earliest.getTime()) / MS_PER_DAY);
}

function dayIndexToDate(dayIndex: number, earliest: Date): Date {
  return new Date(earliest.getTime() + dayIndex * MS_PER_DAY);
}

function dayIndexToFrequency(dayIndex: number, totalDays: number): number {
  // Map 0..totalDays → 530..1700 kHz
  if (totalDays === 0) return 530;
  return 530 + (dayIndex / totalDays) * (1700 - 530);
}

/** Binary search: find index of station nearest to target dayIndex */
function findNearest(stations: DialStation[], targetDay: number): number {
  if (stations.length === 0) return -1;
  let lo = 0;
  let hi = stations.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stations[mid].dayIndex < targetDay) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the first station >= targetDay
  // Compare with lo-1 to find truly nearest
  if (lo > 0) {
    const dLo = Math.abs(stations[lo].dayIndex - targetDay);
    const dPrev = Math.abs(stations[lo - 1].dayIndex - targetDay);
    if (dPrev < dLo) return lo - 1;
  }
  return lo;
}

// ---------- Build Station Index ----------

function buildStationIndex(episodes: Episode[]): StationIndex | null {
  // Filter episodes with valid air dates and sort
  const withDates = episodes
    .filter((ep) => ep.airDate)
    .sort((a, b) => a.airDate!.localeCompare(b.airDate!));

  if (withDates.length === 0) return null;

  const earliest = new Date(withDates[0].airDate! + "T00:00:00");
  const latest = new Date(withDates[withDates.length - 1].airDate! + "T00:00:00");
  const totalDays = dateToDayIndex(latest, earliest);

  const yearsSet = new Set<number>();
  const byDay = new Map<number, DialStation[]>();

  const stations: DialStation[] = withDates.map((ep) => {
    const d = new Date(ep.airDate! + "T00:00:00");
    const dayIndex = dateToDayIndex(d, earliest);
    const year = d.getFullYear();
    yearsSet.add(year);

    const station: DialStation = {
      dayIndex,
      dateStr: ep.airDate!,
      frequency: dayIndexToFrequency(dayIndex, totalDays),
      episode: ep,
      showType: ep.showType || "unknown",
      isNotable: !!ep.aiNotable,
    };

    const existing = byDay.get(dayIndex);
    if (existing) existing.push(station);
    else byDay.set(dayIndex, [station]);

    return station;
  });

  return {
    stations,
    earliest,
    latest,
    totalDays,
    years: Array.from(yearsSet).sort(),
    byDay,
  };
}

// ---------- Signal Strength ----------

function computeSignalStrength(distanceDays: number): number {
  if (distanceDays <= 0.3) return 1;
  if (distanceDays >= 2) return 0;
  // Exponential ease from 0 at 2 days to 1 at 0.3 days
  const t = (distanceDays - 0.3) / (2 - 0.3); // 0..1
  return 1 - t * t; // quadratic ease
}

// ---------- Hook ----------

export function useRadioDial(episodes: Episode[] | undefined) {
  const position = useRadioDialStore((s) => s.position);
  const scanning = useRadioDialStore((s) => s.scanning);
  const subStationIndex = useRadioDialStore((s) => s.subStationIndex);
  const setPosition = useRadioDialStore((s) => s.setPosition);
  const lockEpisode = useRadioDialStore((s) => s.lockEpisode);
  const setSignalStrength = useRadioDialStore((s) => s.setSignalStrength);
  const stopScan = useRadioDialStore((s) => s.stopScan);
  const setSubStationIndex = useRadioDialStore((s) => s.setSubStationIndex);

  // Build station index
  const index = useMemo(
    () => (episodes ? buildStationIndex(episodes) : null),
    [episodes],
  );

  // Find nearest station to current position
  const nearestIdx = useMemo(() => {
    if (!index) return -1;
    return findNearest(index.stations, position);
  }, [index, position]);

  const nearestStation = index && nearestIdx >= 0 ? index.stations[nearestIdx] : null;

  // Distance in days to nearest station
  const distanceDays = nearestStation
    ? Math.abs(nearestStation.dayIndex - position)
    : Infinity;

  // Signal strength
  const signalStrength = computeSignalStrength(distanceDays);

  // Is locked (within 0.3 days of a station)?
  const isLocked = distanceDays <= 0.3;

  // Same-date stations at nearest day
  const sameDateStations = useMemo(() => {
    if (!index || !nearestStation) return [];
    return index.byDay.get(nearestStation.dayIndex) || [];
  }, [index, nearestStation]);

  // Currently displayed station (accounting for sub-station selection)
  const currentStation = useMemo(() => {
    if (!isLocked || sameDateStations.length === 0) return nearestStation;
    const idx = Math.min(subStationIndex, sameDateStations.length - 1);
    return sameDateStations[idx];
  }, [isLocked, sameDateStations, subStationIndex, nearestStation]);

  // Current frequency display
  const frequency = useMemo(() => {
    if (!index) return 530;
    return dayIndexToFrequency(position, index.totalDays);
  }, [index, position]);

  // Current date display
  const currentDate = useMemo(() => {
    if (!index) return null;
    return dayIndexToDate(position, index.earliest);
  }, [index, position]);

  // Update store signal strength
  useEffect(() => {
    setSignalStrength(signalStrength);
  }, [signalStrength, setSignalStrength]);

  // Update store locked episode
  useEffect(() => {
    lockEpisode(isLocked && currentStation ? currentStation.episode : null);
  }, [isLocked, currentStation, lockEpisode]);

  // Initialize position to middle of the dial
  const initialized = useRef(false);
  useEffect(() => {
    if (index && !initialized.current) {
      initialized.current = true;
      setPosition(Math.floor(index.totalDays / 2));
    }
  }, [index, setPosition]);

  // ---------- Scan Mode ----------
  const scanPauseRef = useRef(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!scanning || !index) return;

    const dir = scanning === "forward" ? 1 : -1;
    const SCAN_SPEED = 5; // days per tick at 60fps → ~5 days/sec at 16ms interval
    const PAUSE_DURATION = 3500; // longer pause to allow audio preview
    const GAP_THRESHOLD = 30;

    let lastEpisodeDay = -1;

    const tick = () => {
      if (scanPauseRef.current) return;

      const { position: pos } = useRadioDialStore.getState();
      const newPos = pos + dir * (SCAN_SPEED / 60);

      // Bounds check
      if (newPos < 0 || newPos > index.totalDays) {
        stopScan();
        return;
      }

      // Check if we just hit an episode
      const idx = findNearest(index.stations, newPos);
      if (idx >= 0) {
        const station = index.stations[idx];
        const dist = Math.abs(station.dayIndex - newPos);
        if (dist < 0.5 && station.dayIndex !== lastEpisodeDay) {
          lastEpisodeDay = station.dayIndex;
          scanPauseRef.current = true;
          setPosition(station.dayIndex);

          // Dispatch scan preview event for brief audio snippet
          window.dispatchEvent(
            new CustomEvent("hd:scan-preview", { detail: station.episode }),
          );

          scanTimerRef.current = setTimeout(() => {
            // Stop preview before moving on
            window.dispatchEvent(new CustomEvent("hd:scan-preview-stop"));
            scanPauseRef.current = false;
          }, PAUSE_DURATION);
          return;
        }

        // Accelerate through gaps
        const gap = Math.abs(station.dayIndex - newPos);
        if (gap > GAP_THRESHOLD) {
          // Jump ahead faster
          setPosition(pos + dir * (SCAN_SPEED / 60) * 3);
          return;
        }
      }

      setPosition(newPos);
    };

    const interval = setInterval(tick, 1000 / 60);

    return () => {
      clearInterval(interval);
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanPauseRef.current = false;
    };
  }, [scanning, index, setPosition, stopScan]);

  // ---------- Actions ----------

  const lockToNearest = useCallback(() => {
    if (nearestStation) {
      setPosition(nearestStation.dayIndex);
    }
  }, [nearestStation, setPosition]);

  const jumpToYear = useCallback(
    (year: number) => {
      if (!index) return;
      const jan1 = new Date(`${year}-01-01T00:00:00`);
      const dayIdx = dateToDayIndex(jan1, index.earliest);
      setPosition(Math.max(0, Math.min(dayIdx, index.totalDays)));
    },
    [index, setPosition],
  );

  const cycleSubStation = useCallback(
    (delta: number) => {
      if (sameDateStations.length <= 1) return;
      const next =
        (subStationIndex + delta + sameDateStations.length) %
        sameDateStations.length;
      setSubStationIndex(next);
    },
    [sameDateStations, subStationIndex, setSubStationIndex],
  );

  return {
    index,
    nearestStation,
    currentStation,
    distanceDays,
    signalStrength,
    isLocked,
    frequency,
    currentDate,
    sameDateStations,
    lockToNearest,
    jumpToYear,
    cycleSubStation,
  };
}
