"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Window } from "@/components/win98";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useRadioDial } from "@/hooks/useRadioDial";
import { useRadioStatic } from "@/hooks/useRadioStatic";
import { useIsMobile } from "@/hooks/useMediaQuery";
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

  // Year quick-jump bar
  const yearBar = index ? (
    <div
      className="flex items-center gap-0.5 overflow-x-auto pb-0.5"
      role="tablist"
      aria-label="Jump to year"
    >
      {index.years.map((year) => (
        <button
          key={year}
          onClick={() => {
            ensureInitialized();
            jumpToYear(year);
          }}
          className="text-[10px] md:text-[8px] px-2 md:px-1.5 py-1.5 md:py-0.5 min-h-[44px] md:min-h-0 text-desert-amber/60 hover:text-desert-amber active:text-desert-amber cursor-pointer transition-colors-fast whitespace-nowrap flex-shrink-0"
          role="tab"
          aria-label={`Jump to ${year}`}
        >
          {year}
        </button>
      ))}
    </div>
  ) : null;

  if (!index) {
    // Check if we're still loading or genuinely empty
    const isEmpty = episodes && episodes.length === 0;
    const noValidDates = episodes && episodes.length > 0 && !episodes.some((e) => e.airDate);

    if (isEmpty) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
          <div className="text-[14px] text-desert-amber/60 w98-font">No Stations Found</div>
          <div className="text-[11px] text-bevel-dark max-w-[280px]">
            The radio dial needs episodes to tune into. Import some from the archive or scan local files.
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => router.push("/search")}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-3 py-1 text-[10px] cursor-pointer hover:text-desert-amber transition-colors-fast"
            >
              Search Archive
            </button>
            <button
              onClick={() => router.push("/scanner")}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-3 py-1 text-[10px] cursor-pointer hover:text-desert-amber transition-colors-fast"
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
          <div className="text-[14px] text-desert-amber/60 w98-font">No Dated Episodes</div>
          <div className="text-[11px] text-bevel-dark max-w-[280px]">
            The radio dial maps episodes by air date. Try running AI categorization to detect original broadcast dates.
          </div>
        </div>
      );
    }

    return (
      <Window
        title="AM Radio Dial"
        variant="dark"
        onClose={() => router.push("/library")}
        className="flex flex-col h-full"
      >
        <div className="flex flex-col gap-2 p-2 flex-1 items-center justify-center">
          <div className="w-full max-w-[280px] space-y-3">
            <div className="text-[11px] text-bevel-dark/60 mb-2">
              Calibrating radio dial...
            </div>
            <ProgressBar value={0} variant="dark" />
          </div>
        </div>
      </Window>
    );
  }

  // Mobile layout: full-screen glass overlay
  if (isMobile) {
    return (
      <div
        className="flex flex-col h-full glass-heavy pt-[var(--safe-top)]"
        role="application"
        aria-label="AM Radio Dial"
        onClick={handleInteraction}
      >
        {/* CRT Display */}
        <div className="flex-shrink-0 mx-3 mt-2">
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
        <div className="flex-shrink-0 mx-3 mt-1">{yearBar}</div>

        {/* Tuning Strip */}
        <div className="flex-1 mx-3 my-2 min-h-[120px]">
          <TuningStrip index={index} className="rounded" />
        </div>

        {/* Controls + Signal */}
        <div className="flex-shrink-0 px-3 pb-2 flex flex-col gap-2">
          <SignalMeter signalStrength={signalStrength} />
          <div className="flex items-center gap-2">
            <DialControls
              lockedEpisode={lockedEpisode}
              isLocked={isLocked}
              onLockNearest={lockToNearest}
              className="justify-center flex-wrap flex-1"
            />
            <RadioShortcuts />
          </div>
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
        className="flex flex-col gap-2 p-2 flex-1"
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

        {/* Tuning Strip */}
        <div className="flex-1 min-h-[80px] flex gap-1">
          <div className="flex-1 w98-inset-dark rounded">
            <TuningStrip index={index} className="rounded" />
          </div>
          {/* Zoom controls */}
          <div className="flex flex-col items-center justify-center gap-1 w-[20px]">
            <button
              onClick={() => setZoom(zoom + 0.5)}
              className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer w-full text-center"
              title="Zoom in (Ctrl+Scroll)"
            >+</button>
            <span className="text-[7px] text-bevel-dark/40 tabular-nums">{zoom.toFixed(1)}x</span>
            <button
              onClick={() => setZoom(zoom - 0.5)}
              className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer w-full text-center"
              title="Zoom out (Ctrl+Scroll)"
            >-</button>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
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
