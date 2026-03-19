"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Window } from "@/components/win98";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useRadioDial } from "@/hooks/useRadioDial";
import { useRadioStatic } from "@/hooks/useRadioStatic";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { getPreference, setPreference } from "@/db";
import { cn } from "@/lib/utils/cn";
import { TuningStrip } from "./TuningStrip";
import { FrequencyDisplay } from "./FrequencyDisplay";
import { SignalMeter } from "./SignalMeter";
import { DialControls } from "./DialControls";
import { RadioShortcuts } from "./RadioShortcuts";
import type { Episode } from "@/db/schema";

interface RadioDialProps {
  episodes: Episode[] | undefined;
}

export function RadioDial({ episodes }: RadioDialProps) {
  const router = useRouter();
  const isMobile = useIsMobile();

  const zoom = useRadioDialStore((s) => s.zoom);
  const setZoom = useRadioDialStore((s) => s.setZoom);
  const lockedEpisode = useRadioDialStore((s) => s.lockedEpisode);
  const signalStrength = useRadioDialStore((s) => s.signalStrength);
  const staticEnabled = useRadioDialStore((s) => s.staticEnabled);
  const scanning = useRadioDialStore((s) => s.scanning);
  const subStationIndex = useRadioDialStore((s) => s.subStationIndex);
  const tune = useRadioDialStore((s) => s.tune);
  const stopScan = useRadioDialStore((s) => s.stopScan);

  const {
    index,
    currentStation,
    isLocked,
    frequency,
    currentDate,
    sameDateStations,
    lockToNearest,
    jumpToYear,
    cycleSubStation,
  } = useRadioDial(episodes);

  const { ensureInitialized } = useRadioStatic({
    signalStrength,
    isLocked,
    enabled: staticEnabled,
  });

  // Initialize audio on first interaction
  const handleInteraction = useCallback(() => {
    ensureInitialized();
  }, [ensureInitialized]);

  // First-visit radio hint (persisted in IndexedDB)
  const [radioHint, setRadioHint] = useState(false);
  useEffect(() => {
    if (!index) return;
    let cancelled = false;
    getPreference("radio-hint-dismissed").then((val) => {
      if (cancelled || val) return;
      setTimeout(() => { if (!cancelled) setRadioHint(true); }, 800);
    });
    return () => { cancelled = true; };
  }, [index]);

  const dismissRadioHint = useCallback(() => {
    setRadioHint(false);
    setPreference("radio-hint-dismissed", "1");
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          ensureInitialized();
          if (e.ctrlKey || e.metaKey) tune(-365);
          else if (e.shiftKey) tune(-30);
          else tune(-1);
          break;

        case "ArrowRight":
          e.preventDefault();
          ensureInitialized();
          if (e.ctrlKey || e.metaKey) tune(365);
          else if (e.shiftKey) tune(30);
          else tune(1);
          break;

        case "ArrowUp":
          if (sameDateStations.length > 1) {
            e.preventDefault();
            cycleSubStation(-1);
          }
          break;

        case "ArrowDown":
          if (sameDateStations.length > 1) {
            e.preventDefault();
            cycleSubStation(1);
          }
          break;

        case "Enter":
          e.preventDefault();
          lockToNearest();
          break;

        case "Space":
          e.preventDefault();
          if (lockedEpisode) {
            window.dispatchEvent(
              new CustomEvent("hd:play-episode", { detail: lockedEpisode }),
            );
          }
          break;

        case "KeyS":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const { scanning: sc } = useRadioDialStore.getState();
            if (sc) stopScan();
            else useRadioDialStore.getState().startScan("forward");
          }
          break;

        case "Escape":
          e.preventDefault();
          if (scanning) {
            stopScan();
          } else {
            router.push("/library");
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    tune,
    lockToNearest,
    lockedEpisode,
    scanning,
    stopScan,
    sameDateStations,
    cycleSubStation,
    router,
    ensureInitialized,
  ]);

  // Current year for distance-fade on mobile
  const currentYear = currentDate ? currentDate.getFullYear() : null;

  // Year quick-jump bar
  const yearBar = index ? (
    <div
      className="flex items-center gap-0 md:gap-0.5 overflow-x-auto pb-0.5"
      role="tablist"
      aria-label="Jump to year"
    >
      {index.years.filter((y) => Number.isFinite(y)).map((year) => {
        // Distance-based opacity fade on mobile
        const dist = currentYear ? Math.abs(year - currentYear) : 0;
        const mobileOpacity = currentYear
          ? Math.max(0.15, 1 - dist * 0.15)
          : 0.4;
        const isCurrentYear = year === currentYear;

        return (
          <button
            key={year}
            onClick={() => {
              ensureInitialized();
              jumpToYear(year);
            }}
            className={cn(
              "md:text-hd-8 md:px-1.5 md:py-0.5 md:min-h-0 text-desert-amber hover:text-desert-amber active:text-desert-amber cursor-pointer transition-colors-fast whitespace-nowrap flex-shrink-0",
              // Mobile: monospace abbreviated years
              "text-hd-9 px-[7px] py-2 min-h-[44px] font-mono tracking-wide",
              isCurrentYear && "font-bold md:font-normal",
            )}
            style={isMobile ? {
              opacity: mobileOpacity,
              textShadow: isCurrentYear ? "0 0 8px rgba(212,168,67,0.3)" : "none",
              fontSize: isCurrentYear ? "10px" : undefined,
            } : undefined}
            role="tab"
            aria-label={`Jump to ${year}`}
          >
            <span className="md:hidden">&rsquo;{String(year).slice(2)}</span>
            <span className="hidden md:inline">{year}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  if (!index) {
    // Check if we're still loading or genuinely empty
    const isEmpty = episodes && episodes.length === 0;
    const noValidDates = episodes && episodes.length > 0 && !episodes.some((e) => e.airDate);

    if (isEmpty) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
          <div className="text-hd-14 text-desert-amber/60 w98-font">No Stations Found</div>
          <div className="text-hd-11 text-bevel-dark max-w-[280px]">
            The radio dial needs episodes to tune into. Import some from the archive or scan local files.
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => router.push("/search")}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-3 py-1 text-hd-10 cursor-pointer hover:text-desert-amber transition-colors-fast"
            >
              Search Archive
            </button>
            <button
              onClick={() => router.push("/scanner")}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-3 py-1 text-hd-10 cursor-pointer hover:text-desert-amber transition-colors-fast"
            >
              Scan Files
            </button>
          </div>
        </div>
      );
    }

    if (noValidDates) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
          <div className="text-hd-14 text-desert-amber/60 w98-font">No Dated Episodes</div>
          <div className="text-hd-11 text-bevel-dark max-w-[280px]">
            The radio dial maps episodes by air date. Try running AI categorization to detect original broadcast dates.
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full text-bevel-dark text-hd-11">
        Loading station index...
      </div>
    );
  }

  // Mobile layout: full-screen cinematic radio
  if (isMobile) {
    return (
      <div
        className="flex flex-col h-full pt-[var(--safe-top)]"
        role="application"
        aria-label="AM Radio Dial"
        onClick={handleInteraction}
      >
        {/* CRT Display — phosphor glow */}
        <div className="flex-shrink-0 mx-5 mt-3">
          <FrequencyDisplay
            frequency={frequency}
            currentDate={currentDate}
            currentStation={currentStation}
            isLocked={isLocked}
            signalStrength={signalStrength}
            sameDateCount={sameDateStations.length}
            subStationIndex={subStationIndex}
          />
        </div>

        {/* Year quick-jump */}
        <div className="flex-shrink-0 mx-5 mt-3">{yearBar}</div>

        {/* First-visit hint */}
        {radioHint && (
          <div className="mx-5 mt-2 px-3 py-2 bg-desert-amber/10 border border-desert-amber/20 rounded flex items-center justify-between gap-2 flex-shrink-0 animate-fade-in">
            <span className="text-hd-12 text-desert-amber/80">
              Drag the dial to tune through the archive. Tap Seek to lock onto the nearest station.
            </span>
            <button
              onClick={dismissRadioHint}
              className="text-hd-12 text-bevel-dark/50 active:text-desktop-gray cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
            >
              OK
            </button>
          </div>
        )}

        {/* Tuning Strip */}
        <div className="flex-1 mx-4 my-1 min-h-[140px]">
          <TuningStrip index={index} className="rounded-lg" />
        </div>

        {/* Signal + Controls */}
        <div className="flex-shrink-0 px-5 pb-[max(1.5rem,var(--safe-bottom))] flex flex-col gap-3">
          <SignalMeter signalStrength={signalStrength} />
          <DialControls
            lockedEpisode={lockedEpisode}
            isLocked={isLocked}
            onLockNearest={lockToNearest}
          />
        </div>
      </div>
    );
  }

  // Desktop layout: Window component
  return (
    <Window
      title="AM Radio Dial"
      variant="dark"
      onClose={() => router.push("/library")}
      className="flex flex-col h-full"
    >
      <div
        className="flex flex-col gap-1 p-2 flex-1"
        role="application"
        aria-label="AM Radio Dial"
        onClick={handleInteraction}
      >
        {/* CRT Display */}
        <FrequencyDisplay
          frequency={frequency}
          currentDate={currentDate}
          currentStation={currentStation}
          isLocked={isLocked}
          signalStrength={signalStrength}
          sameDateCount={sameDateStations.length}
          subStationIndex={subStationIndex}
        />

        {/* Year quick-jump */}
        {yearBar}

        {/* First-visit hint */}
        {radioHint && (
          <div className="px-2 py-1.5 w98-inset-dark rounded flex items-center justify-between gap-2 animate-fade-in">
            <span className="text-hd-10 text-desert-amber/80">
              Drag the dial to tune through the archive chronologically. Press Enter or click Seek to lock onto the nearest station.
            </span>
            <button
              onClick={dismissRadioHint}
              className="text-hd-10 text-bevel-dark/50 hover:text-desktop-gray cursor-pointer min-w-[24px] flex items-center justify-center"
            >
              OK
            </button>
          </div>
        )}

        {/* Tuning Strip */}
        <div className="flex-1 min-h-[60px] flex gap-1">
          <div className="flex-1 w98-inset-dark rounded">
            <TuningStrip index={index} className="rounded" />
          </div>
          {/* Zoom controls */}
          <div className="flex flex-col items-center justify-center gap-1 w-[20px]">
            <button
              onClick={() => setZoom(zoom + 0.5)}
              className="text-hd-9 text-bevel-dark hover:text-desktop-gray cursor-pointer w-full text-center"
              title="Zoom in (Ctrl+Scroll)"
            >+</button>
            <span className="text-hd-7 text-bevel-dark/40 tabular-nums">{zoom.toFixed(1)}x</span>
            <button
              onClick={() => setZoom(zoom - 0.5)}
              className="text-hd-9 text-bevel-dark hover:text-desktop-gray cursor-pointer w-full text-center"
              title="Zoom out (Ctrl+Scroll)"
            >-</button>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          <DialControls
            lockedEpisode={lockedEpisode}
            isLocked={isLocked}
            onLockNearest={lockToNearest}
            className="flex-1"
          />
          <SignalMeter
            signalStrength={signalStrength}
            className="w-[120px] flex-shrink-0"
          />
          <RadioShortcuts />
        </div>
      </div>
    </Window>
  );
}
